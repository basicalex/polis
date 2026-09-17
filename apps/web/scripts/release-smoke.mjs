// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const screenshotsDir = '/tmp/polis-release-qa';
const host = '127.0.0.1';
const port = Number(process.env.POLIS_RELEASE_QA_PORT ?? '8787');
const remoteBaseUrl = process.env.POLIS_RELEASE_BASE_URL?.replace(/\/+$/, '');
const baseUrl = remoteBaseUrl || `http://${host}:${port}`;
const baseOrigin = new URL(baseUrl).origin;

/* The six sections of About, in the order the page reads them (decision D3). */
const aboutSectionIds = [
  'sto-je-polis',
  'kako-radi',
  'javno-i-otvoreno',
  'tko-stoji-iza',
  'podaci',
  'izdanje',
];
const aboutCopy = {
  hr: { path: '/o-polisu', heading: 'O Polisu' },
  en: { path: '/en/o-polisu', heading: 'About Polis' },
};
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const forbiddenClientMarkers = [
  'http://localhost:8080',
  'https://api.polis.intrface.eu',
  '/api/v1/',
  'window.__API_URL',
  'web_session',
];

async function assertClientBundleSafe() {
  const clientRoot = path.join(appRoot, 'dist', 'client');
  const entries = await readdir(clientRoot, { recursive: true, withFileTypes: true });
  const findings = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:html|js|mjs|css)$/.test(entry.name)) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    const source = await readFile(filePath, 'utf8');
    for (const marker of forbiddenClientMarkers) {
      if (source.includes(marker)) findings.push(`${path.relative(clientRoot, filePath)}: ${marker}`);
    }
  }
  assert(findings.length === 0, `release client bundle exposes backend markers:\n${findings.join('\n')}`);
}

async function systemChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next system installation. Playwright browser downloads are forbidden here.
    }
  }
  throw new Error(`System Chrome not found; set CHROME_PATH. Checked: ${chromeCandidates.join(', ')}`);
}

function signalProcessGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcessGroup(child, 'SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!exited) signalProcessGroup(child, 'SIGKILL');
}

async function waitForWrangler(child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      if (response.status < 500) return;
      lastError = new Error(`readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler readiness timed out: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function trackRequests(context, forbiddenRequests) {
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    const backendPath = url.pathname === '/version' || url.pathname.startsWith('/api/');
    if (url.origin !== baseOrigin || backendPath) {
      forbiddenRequests.push(`${request.method()} ${request.resourceType()} ${url.href}`);
    }
  });
}

/* About is the one page that explains Polis; every retired address lands here. */
async function assertAbout(page, language) {
  const copy = aboutCopy[language];
  const response = await page.goto(`${baseUrl}${copy.path}`, { waitUntil: 'domcontentloaded' });
  assert(response, `${copy.path} returned no response`);
  assert(response.status() === 200, `${copy.path} returned ${response.status()} instead of 200`);

  const heading = (await page.locator('h1').first().innerText()).trim();
  assert(heading === copy.heading, `${page.url()} is titled "${heading}" instead of "${copy.heading}"`);

  const ids = await page
    .locator('.about-heading')
    .evaluateAll((elements) => elements.map((element) => element.id));
  assert(
    ids.length === aboutSectionIds.length && ids.every((id, index) => id === aboutSectionIds[index]),
    `${page.url()} renders the sections ${ids.join(', ')}`,
  );
}

const entryCopy = {
  hr: { question: 'Gdje ste?', record: 'Javni zapis', report: 'Prijavite problem', place: 'Općina Vrsar' },
  en: {
    question: 'Where are you?',
    record: 'Public record',
    report: 'Report a problem',
    place: 'Vrsar Municipality',
  },
};

/** S1: the root asks one thing and shows the map, nothing else (entry-flow R1). */
async function assertEntryMap(page, language) {
  const heading = (await page.locator('h1').first().innerText()).trim();
  assert(heading === entryCopy[language].question, `${page.url()} asks "${heading}" instead of the one question`);
  assert(await page.$('[data-entry-map] svg[data-map]'), `${page.url()} renders no map`);

  const countyControls = await page.locator('[data-layer="counties"] a[data-county]').count();
  assert(countyControls === 21, `${page.url()} renders ${countyControls} county controls instead of 21`);

  const regionOptions = await page.locator('select[data-region] option').count();
  assert(regionOptions === 22, `${page.url()} region select has ${regionOptions} options instead of 22`);

  const demoLinks = await page
    .locator('a[href^="/demo/"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  assert(demoLinks.length === 0, `${page.url()} still opens the demo from the front door: ${demoLinks.join(', ')}`);
}

/** The region carries in the URL, so a chosen county server-renders its places. */
async function assertCountyView(page, language) {
  const base = language === 'en' ? '/en/' : '/';
  await page.goto(`${baseUrl}${base}?zupanija=istarska`, { waitUntil: 'domcontentloaded' });
  const hrefs = await page
    .locator('[data-county-list] a[href]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  assert(
    hrefs.includes(`${base}vrsar`),
    `${page.url()} does not list the live place: ${hrefs.slice(0, 5).join(', ')}`,
  );

  // With scripting on, the same county draws on the map from its own data file.
  await page.waitForSelector('[data-layer="places"] [data-place="vrsar"]', { timeout: 10_000 });
  const status = await page.getAttribute('[data-layer="places"] [data-place="vrsar"]', 'data-status');
  assert(status === 'live', `the live place draws as ${status}`);
  const drawn = await page.locator('[data-layer="places"] [data-place]').count();
  assert(drawn > 20, `${page.url()} drew ${drawn} municipalities for Istria`);
}

/** S2: two buttons, record then filing, each a whole tappable surface (R7). */
async function assertIntent(page, language) {
  const base = language === 'en' ? '/en/' : '/';
  await page.goto(`${baseUrl}${base}vrsar`, { waitUntil: 'load' });
  const name = (await page.locator('h1').first().innerText()).trim();
  assert(name === entryCopy[language].place, `${page.url()} names the place "${name}"`);

  const buttons = await page.locator('.intent-choices a.btn').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { href: element.getAttribute('href'), text: element.textContent?.trim(), height: box.height };
    }),
  );
  assert(buttons.length === 2, `${page.url()} renders ${buttons.length} intent buttons instead of 2`);
  assert(buttons[0].href === `${base}vrsar/zapis`, `first button is ${buttons[0].href}`);
  assert(buttons[1].href === `${base}vrsar/prijava`, `second button is ${buttons[1].href}`);
  assert(buttons[0].text === entryCopy[language].record, `first button says ${buttons[0].text}`);
  assert(buttons[1].text === entryCopy[language].report, `second button says ${buttons[1].text}`);
  for (const button of buttons) {
    assert(button.height >= 96, `${button.href} is ${button.height}px tall, under 96px`);
  }
}

async function assertGeometry(page, label) {
  // Remote hosts can reach domcontentloaded before the stylesheet applies;
  // measuring unstyled controls reports false sub-44px targets.
  await page.waitForLoadState('load');
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(
    geometry.scrollWidth <= geometry.clientWidth + 1,
    `${label} overflows horizontally: ${geometry.scrollWidth}px > ${geometry.clientWidth}px`,
  );

  const shortControls = await page.locator('button, [role="button"], nav a, input, select, textarea').evaluateAll(
    (elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
            width: box.width,
            height: box.height,
          };
        })
        .filter((control) => control.width < 44 || control.height < 44),
  );
  assert(shortControls.length === 0, `${label} has controls below 44px: ${JSON.stringify(shortControls)}`);
}

async function assertKeyboardFocus(page) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      text: element.getAttribute('aria-label') || element.textContent?.trim(),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  assert(focus && focus.tag !== 'BODY', 'Tab did not move focus to an interactive control');
  assert(
    focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px',
    `focused control has no visible outline: ${JSON.stringify(focus)}`,
  );
}

async function assertReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/o-polisu`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const runningLongAnimations = document
      .getAnimations()
      .filter((animation) => {
        const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
        return animation.playState === 'running' && duration > 100;
      })
      .map((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0));
    return {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      runningLongAnimations,
    };
  });
  assert(result.mediaMatches, 'reduced-motion emulation did not reach the page');
  assert(
    result.runningLongAnimations.length === 0,
    `reduced motion leaves long animations running: ${result.runningLongAnimations.join(', ')}`,
  );
}

let wrangler;
let browser;
let signalCleanupStarted = false;
const forbiddenRequests = [];

async function cleanupFromSignal(exitCode) {
  if (signalCleanupStarted) return;
  signalCleanupStarted = true;
  try {
    if (browser) await browser.close();
  } finally {
    if (wrangler) await stopProcessGroup(wrangler);
    process.exit(exitCode);
  }
}

const onSigint = () => void cleanupFromSignal(130);
const onSigterm = () => void cleanupFromSignal(143);
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

try {
  await mkdir(screenshotsDir, { recursive: true });
  await assertClientBundleSafe();
  if (!remoteBaseUrl) {
    wrangler = spawn(
      process.execPath,
      ['x', 'wrangler', 'dev', '--env', 'preview', '--local', '--ip', host, '--port', String(port)],
      {
        cwd: appRoot,
        env: process.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    wrangler.stdout?.on('data', (chunk) => process.stdout.write(chunk));
    wrangler.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    await waitForWrangler(wrangler);
  }

  browser = await chromium.launch({
    executablePath: await systemChrome(),
    headless: true,
    args: ['--disable-background-networking', '--no-first-run'],
  });

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  trackRequests(desktop, forbiddenRequests);
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await assertEntryMap(desktopPage, 'hr');
  await assertGeometry(desktopPage, 'map desktop');
  await assertKeyboardFocus(desktopPage);
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'map-1440x900.png'), fullPage: true });

  await assertCountyView(desktopPage, 'hr');
  await assertGeometry(desktopPage, 'county desktop');
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'county-1440x900.png'), fullPage: true });

  await assertIntent(desktopPage, 'hr');
  await assertGeometry(desktopPage, 'intent desktop');
  await assertKeyboardFocus(desktopPage);
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'intent-1440x900.png'), fullPage: true });

  await desktopPage.goto(`${baseUrl}/en/`, { waitUntil: 'domcontentloaded' });
  await assertEntryMap(desktopPage, 'en');
  await assertGeometry(desktopPage, 'English map desktop');
  await assertIntent(desktopPage, 'en');

  await assertAbout(desktopPage, 'hr');
  await assertGeometry(desktopPage, 'desktop');
  await assertKeyboardFocus(desktopPage);
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'desktop-1440x900.png'), fullPage: true });

  await assertAbout(desktopPage, 'en');
  await assertGeometry(desktopPage, 'English desktop');

  // Nothing 404s: the old Croatian home keeps its query, and every address
  // decision D3 retired is a permanent redirect to About.
  for (const [legacy, target] of [
    ['/hr/', '/'],
    ['/hr/presentation', '/o-polisu'],
    ['/presentation', '/o-polisu'],
    ['/en/presentation', '/en/o-polisu'],
    ['/transparency', '/o-polisu'],
    ['/privacy', '/o-polisu'],
    ['/source', '/o-polisu'],
    ['/security', '/o-polisu'],
    ['/methodology', '/o-polisu'],
    ['/docs', '/o-polisu'],
    ['/demo', '/o-polisu'],
    ['/demo/citizen', '/o-polisu'],
    ['/demo/official', '/o-polisu'],
    ['/demo/review', '/o-polisu'],
    ['/demo/record', '/o-polisu'],
    ['/demo/embed', '/o-polisu'],
  ]) {
    const response = await desktopPage.goto(`${baseUrl}${legacy}`, { waitUntil: 'domcontentloaded' });
    assert(response, `${legacy} returned no response`);
    assert(response.status() === 200, `${legacy} ended on ${response.status()}`);
    assert(
      new URL(desktopPage.url()).pathname === target,
      `${legacy} did not redirect to ${target}: ${desktopPage.url()}`,
    );
  }

  // The place map and the intent screen are safe, but everything behind the two
  // buttons needs the pilot backend, which the release build does not carry.
  for (const boundaryCase of [
    { path: '/partners', kind: 'backend-dependent' },
    { path: '/vrsar/zapis', kind: 'backend-dependent' },
    { path: '/vrsar/zapis/VRS-123456', kind: 'backend-dependent' },
    { path: '/vrsar/prijava', kind: 'backend-dependent' },
    { path: '/vrsar/prijava/VRS-123456', kind: 'backend-dependent' },
    { path: '/en/vrsar/zapis', kind: 'backend-dependent' },
    { path: '/en/vrsar/prijava', kind: 'backend-dependent' },
    { path: '/complaints/case-private', kind: 'restricted' },
    { path: '/contribute/review', kind: 'not-live' },
  ]) {
    const response = await desktopPage.goto(`${baseUrl}${boundaryCase.path}`, {
      waitUntil: 'domcontentloaded',
    });
    assert(response, `${boundaryCase.path} returned no response`);
    assert(
      response.headers()['x-polis-release-boundary'] === boundaryCase.kind,
      `${boundaryCase.path} did not render the ${boundaryCase.kind} boundary`,
    );
    assert(
      (await desktopPage.locator('body').innerText()).toLowerCase().includes('release'),
      `${boundaryCase.path} did not render release-boundary content`,
    );
  }

  // Gating the flow must not take the two buttons off the intent screen.
  await assertIntent(desktopPage, 'hr');

  // The old presenter link still lands somewhere real, now About.
  const legacyPresent = await desktopPage.goto(`${baseUrl}/?present=1`, {
    waitUntil: 'domcontentloaded',
  });
  assert(legacyPresent, '/?present=1 returned no response');
  assert(
    new URL(desktopPage.url()).pathname === '/o-polisu',
    `/?present=1 did not reach About: ${desktopPage.url()}`,
  );
  await desktopPage.setViewportSize({ width: 1920, height: 1080 });
  await assertGeometry(desktopPage, 'about 1920x1080');
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'about-1920x1080.png') });
  await assertReducedMotion(desktopPage);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  trackRequests(mobile, forbiddenRequests);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await assertEntryMap(mobilePage, 'hr');
  await assertGeometry(mobilePage, 'map mobile');
  await mobilePage.screenshot({
    path: path.join(screenshotsDir, 'map-mobile-390x844.png'),
    fullPage: true,
  });

  await assertCountyView(mobilePage, 'hr');
  await assertGeometry(mobilePage, 'county mobile');
  await mobilePage.screenshot({
    path: path.join(screenshotsDir, 'county-mobile-390x844.png'),
    fullPage: true,
  });

  await assertIntent(mobilePage, 'hr');
  await assertGeometry(mobilePage, 'intent mobile');
  await mobilePage.screenshot({
    path: path.join(screenshotsDir, 'intent-mobile-390x844.png'),
    fullPage: true,
  });

  await mobilePage.goto(`${baseUrl}/en/`, { waitUntil: 'domcontentloaded' });
  await assertEntryMap(mobilePage, 'en');
  await assertGeometry(mobilePage, 'English map mobile');

  await assertAbout(mobilePage, 'hr');
  await assertGeometry(mobilePage, 'mobile');
  await assertKeyboardFocus(mobilePage);
  await mobilePage.screenshot({ path: path.join(screenshotsDir, 'mobile-390x844.png'), fullPage: true });
  await mobile.close();

  assert(
    forbiddenRequests.length === 0,
    `release browser made forbidden requests:\n${forbiddenRequests.join('\n')}`,
  );
  console.log(`release smoke passed; screenshots: ${screenshotsDir}`);
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  if (browser) await browser.close();
  if (wrangler) await stopProcessGroup(wrangler);
}

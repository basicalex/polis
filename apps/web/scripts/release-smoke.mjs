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

const stageLabels = {
  en: ['voice', 'responsibility', 'response', 'independent check', 'public receipt'],
  hr: ['glas', 'odgovornost', 'odgovor', 'neovisna provjera', 'javna potvrda'],
};
const stageIds = ['voice', 'responsibility', 'response', 'check', 'receipt'];

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

async function assertStages(page, language) {
  const stages = await page.locator('[data-release-stage]').evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.getAttribute('data-stage'),
      text: element.textContent ?? '',
    })),
  );
  assert(stages.length === 5, `${page.url()} renders ${stages.length} release stages instead of 5`);
  assert(
    stages.every((stage, index) => stage.id === stageIds[index]),
    `${page.url()} has the wrong stage order: ${stages.map((stage) => stage.id).join(', ')}`,
  );
  const text = stages
    .map((stage) => stage.text)
    .join(' ')
    .toLocaleLowerCase(language === 'hr' ? 'hr' : 'en');
  for (const label of stageLabels[language]) {
    assert(text.includes(label), `${page.url()} is missing the ${label} stage`);
  }
}

async function assertLanding(page, language) {
  const required = [
    '/demo/citizen',
    '/demo/official',
    '/demo/review',
    '/demo/record',
    '/demo/embed',
    language === 'hr' ? '/hr/presentation' : '/presentation',
  ];
  const hrefs = await page
    .locator('.landing a[href]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  for (const href of required) {
    assert(hrefs.includes(href), `${page.url()} is missing a landing link to ${href}`);
  }
  const heading = (await page.locator('h1').first().innerText()).trim();
  assert(heading.length > 0, `${page.url()} renders no landing headline`);
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

async function assertVerifier(page) {
  const original = page.getByRole('button', { name: /use exact fixture bytes/i });
  const changed = page.getByRole('button', { name: /change one byte/i });
  assert((await original.count()) === 1, 'original-byte verifier control is missing');
  assert((await changed.count()) === 1, 'changed-byte verifier control is missing');

  await original.click();
  assert((await page.locator('[data-verifier-result]').textContent())?.trim() === 'EXACT MATCH', 'exact-match result is missing');
  await changed.click();
  assert(
    (await page.locator('[data-verifier-result]').textContent())?.trim() === 'CHANGED BYTE — NO MATCH',
    'changed-byte mismatch result is missing',
  );
  const body = await page.locator('body').innerText();
  assert(body.includes('does not make the claim true'), 'verifier truth limitation is missing');
}

async function activePresenterStage(page) {
  return page.evaluate(() => {
    const active = document.querySelector(
      '[aria-current="step"], [data-active="true"], [data-present-active="true"], [data-stage][aria-hidden="false"]',
    );
    return active?.getAttribute('data-stage') || active?.textContent?.trim() || null;
  });
}

async function assertPresenterKeyboard(page) {
  const before = await activePresenterStage(page);
  assert(before, 'presenter mode has no programmatic active-stage marker');
  await page.keyboard.press('ArrowRight');
  const after = await activePresenterStage(page);
  assert(after && after !== before, 'ArrowRight did not advance presenter mode');
  await page.keyboard.press('Home');
  const home = await activePresenterStage(page);
  assert(home, 'Home removed the presenter active stage');
  await page.keyboard.press('End');
  const end = await activePresenterStage(page);
  assert(end && end !== home, 'End did not move to the final presenter stage');

  for (let index = 0; index < 5; index += 1) {
    const verifierButton = page.getByRole('button', { name: /use exact fixture bytes/i });
    if ((await verifierButton.count()) === 1 && (await verifierButton.isVisible())) {
      await verifierButton.focus();
      const stageBeforeControlKey = await activePresenterStage(page);
      await page.keyboard.press('ArrowRight');
      assert(
        (await activePresenterStage(page)) === stageBeforeControlKey,
        'presenter navigation handled ArrowRight from a form control',
      );
      return;
    }
    await page.keyboard.press('ArrowLeft');
  }
  throw new Error('presenter verifier control did not become visible');
}

async function assertReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/presentation`, { waitUntil: 'domcontentloaded' });
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
  await assertLanding(desktopPage, 'en');
  await assertGeometry(desktopPage, 'landing desktop');
  await assertKeyboardFocus(desktopPage);
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'landing-1440x900.png'), fullPage: true });

  await desktopPage.goto(`${baseUrl}/hr/`, { waitUntil: 'domcontentloaded' });
  await assertLanding(desktopPage, 'hr');
  await assertGeometry(desktopPage, 'Croatian landing desktop');

  await desktopPage.goto(`${baseUrl}/presentation`, { waitUntil: 'domcontentloaded' });
  await assertStages(desktopPage, 'en');
  await assertGeometry(desktopPage, 'desktop');
  await assertKeyboardFocus(desktopPage);
  await assertVerifier(desktopPage);
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'desktop-1440x900.png'), fullPage: true });

  await desktopPage.goto(`${baseUrl}/hr/presentation`, { waitUntil: 'domcontentloaded' });
  await assertStages(desktopPage, 'hr');
  await assertGeometry(desktopPage, 'Croatian desktop');

  for (const demoPath of [
    '/demo/citizen',
    '/demo/official',
    '/demo/review',
    '/demo/record',
    '/demo/embed',
  ]) {
    const demoResponse = await desktopPage.goto(`${baseUrl}${demoPath}`, {
      waitUntil: 'domcontentloaded',
    });
    assert(demoResponse, `${demoPath} returned no response`);
    assert(
      demoResponse.status() === 200,
      `${demoPath} returned ${demoResponse.status()} instead of 200`,
    );
    const hasShell = await desktopPage.$('[data-demo-shell]');
    assert(hasShell, `${demoPath} does not render the demo shell`);
  }

  for (const boundaryCase of [
    { path: '/partners', kind: 'backend-dependent' },
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

  const legacyPresent = await desktopPage.goto(`${baseUrl}/?present=1`, {
    waitUntil: 'domcontentloaded',
  });
  assert(legacyPresent, '/?present=1 returned no response');
  assert(
    new URL(desktopPage.url()).pathname === '/presentation',
    `/?present=1 did not reach the presentation: ${desktopPage.url()}`,
  );
  await assertStages(desktopPage, 'en');
  await assertGeometry(desktopPage, 'presenter');
  await assertPresenterKeyboard(desktopPage);
  await desktopPage.setViewportSize({ width: 1920, height: 1080 });
  await assertGeometry(desktopPage, 'presenter 1920x1080');
  await desktopPage.screenshot({ path: path.join(screenshotsDir, 'presenter-1920x1080.png') });
  await assertReducedMotion(desktopPage);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  trackRequests(mobile, forbiddenRequests);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await assertLanding(mobilePage, 'en');
  await assertGeometry(mobilePage, 'landing mobile');
  await mobilePage.screenshot({
    path: path.join(screenshotsDir, 'landing-mobile-390x844.png'),
    fullPage: true,
  });

  await mobilePage.goto(`${baseUrl}/hr/`, { waitUntil: 'domcontentloaded' });
  await assertLanding(mobilePage, 'hr');
  await assertGeometry(mobilePage, 'Croatian landing mobile');

  await mobilePage.goto(`${baseUrl}/presentation`, { waitUntil: 'domcontentloaded' });
  await assertStages(mobilePage, 'en');
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

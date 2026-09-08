#!/usr/bin/env bun

import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { decodedEmailBodies } from '../../../scripts/pilot/mail-codec.mjs';
import {
  assertOwnedRuntime,
  parseArgs,
  readJson,
} from '../../../scripts/pilot/runtime-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const API_ROOT = '/pilot/vrsar/api';
const SESSION_COOKIE = 'polis_pilot_session';
const CONTROLLED_IDENTITIES = Object.freeze({
  resident: 'resident@vrsar.example.test',
  other: 'other@vrsar.example.test',
  official: 'official@vrsar.example.test',
  reviewer: 'reviewer@vrsar.example.test',
});
const ROLE_DESTINATIONS = Object.freeze({
  resident: '/pilot/vrsar/cases',
  other: '/pilot/vrsar/cases',
  official: '/pilot/vrsar/staff',
  reviewer: '/pilot/vrsar/review',
});
const DEFAULT_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 25_000;
const MAIL_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 570_000;
const PRIVATE_PUBLIC_KEYS = new Set([
  'id',
  'municipalityId',
  'category',
  'office',
  'status',
  'publicSummary',
  'commitment',
  'dueDate',
  'evidenceNote',
  'evidenceUrls',
  'publishedAt',
  'resolvedAt',
  'events',
  'receiptHash',
  'testEnvironment',
]);
const PUBLIC_EVENT_KEYS = new Set(['stage', 'action', 'actorRole', 'createdAt']);
const PUBLIC_EVENT_MILESTONES = Object.freeze([
  Object.freeze({ stage: 'voice', action: 'report-filed', actorRole: 'resident' }),
  Object.freeze({ stage: 'responsibility', action: 'office-assigned', actorRole: 'official' }),
  Object.freeze({ stage: 'response', action: 'commitment-filed', actorRole: 'official' }),
  Object.freeze({ stage: 'check', action: 'commitment-accepted', actorRole: 'reviewer' }),
  Object.freeze({ stage: 'receipt', action: 'published', actorRole: 'reviewer' }),
  Object.freeze({ stage: 'receipt', action: 'completion-approved', actorRole: 'reviewer' }),
]);
const expectedResourceConsoleErrors = new WeakMap();
const RECEIPT_HASH_KEYS = Object.freeze([
  'id',
  'municipalityId',
  'category',
  'office',
  'status',
  'publicSummary',
  'commitment',
  'dueDate',
  'evidenceNote',
  'evidenceUrls',
  'publishedAt',
  'resolvedAt',
  'events',
  'testEnvironment',
]);

const CHECKS = Object.freeze([
  ['V01', 'Owned loopback runtime is running'],
  ['V02', 'Four controlled identities sign in through captured email links'],
  ['V03', 'Session cookies and browser storage keep tokens out of script access'],
  ['V04', 'Resident files private material and a private upload through the UI'],
  ['V05', 'Unreviewed record stays absent from public detail and public list'],
  ['V06', 'Second resident cannot read the first resident private record'],
  ['V07', 'Missing and foreign request origins are rejected'],
  ['V08', 'Official assigns the record and submits a commitment through the UI'],
  ['V09', 'Official cannot perform commitment review'],
  ['V10', 'Reviewer return, official revision, and reviewer publication work through the UI'],
  ['V11', 'Published commitment is not shown as completed and private data stays private'],
  ['V12', 'Completion evidence is returned once, revised, and accepted through the UI'],
  ['V13', 'Resolved public JSON, DOM, print, and receipt hash stay consistent and private-safe'],
  ['V14', 'HR, IT, and EN views work at desktop and phone sizes with keyboard and reduced motion'],
  ['V15', 'Refreshes and separate browser contexts show consistent final state'],
  ['V16', 'Logout clears the cookie and revokes the old session'],
  ['V17', 'Journey pages produce no browser console, page, or request errors'],
  ['V18', 'One public screenshot batch is captured outside the repository'],
]);

function usage() {
  return [
    'usage:',
    '  bun scripts/run-with-timeout.mjs 600 -- bun scripts/vrsar-acceptance.mjs \\',
    '    --runtime <printed-runtime-path> --url <printed-web-url> [options]',
    '',
    'options:',
    '  --output <outside-repo-dir>  JSON report and screenshots destination',
    '  --browser <chromium-path>     Override Playwright Chromium executable',
    '  --skip-screenshots            Run functional checks without recapturing images',
    '  --help                        Print this help',
  ].join('\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isOutsideRepo(target) {
  const relative = path.relative(REPO_ROOT, path.resolve(target));
  return relative !== '' && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

function isLoopback(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function containsAny(haystack, values) {
  const text = String(haystack);
  return values.some((value) => value && text.includes(value));
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|code|state|session|email/i.test(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

function redactor(privateValues) {
  const replacements = [
    ...Object.values(CONTROLLED_IDENTITIES),
    ...privateValues,
  ].filter(Boolean);
  return (input) => {
    let output = String(input ?? 'Unknown failure');
    output = output.replace(/https?:\/\/[^\s]+/gi, (match) => safeUrl(match));
    output = output.replace(/(polis_pilot_session|sessionToken|magicToken|token)=([^;\s&]+)/gi, '$1=[redacted]');
    output = output.replace(/([?&#](?:token|code|state|session|email)=)[^&\s]+/gi, '$1[redacted]');
    for (const value of replacements) output = output.split(value).join('[private-fixture]');
    output = output.replace(/[A-Za-z0-9_-]{80,}/g, '[redacted-long-value]');
    return normalizedText(output).slice(0, 600);
  };
}

async function waitUntil(operation, description, timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new Error(`${description} timed out${suffix}`);
}

async function readMailbox(capturePath) {
  let source = '';
  try {
    source = await readFile(capturePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return source
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function magicLinkFromMessage(message, expectedOrigin) {
  const candidates = decodedEmailBodies(String(message.data ?? ''))
    .flatMap((body) => String(body).replaceAll('&amp;', '&').match(/https?:\/\/[^\s"'<>]+/g) ?? []);
  for (const candidate of candidates) {
    let url;
    try {
      url = new URL(candidate.replace(/[),.;]+$/, ''));
    } catch {
      continue;
    }
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (
      url.origin === expectedOrigin &&
      url.pathname === '/pilot/vrsar/login' &&
      fragment.get('email') &&
      fragment.get('token')
    ) return url.toString();
  }
  throw new Error('captured sign-in email did not contain the expected fragment link');
}

async function requestAndOpenMagicLink(page, identity, email, destination, mailboxPath, baseUrl) {
  const before = new Set((await readMailbox(mailboxPath)).map((message) => message.id));
  await page.goto(`${baseUrl}/pilot/vrsar/login?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('#pilot-email').waitFor({ state: 'visible' });
  assert(await page.locator('select[name="role"], input[name="role"]').count() === 0, 'login page exposes a role selector');
  await page.locator('#pilot-email').fill(email);
  await page.locator('[data-magic-submit]').click();
  await page.locator('[data-page-state][data-tone="success"]').waitFor({ state: 'visible' });

  const message = await waitUntil(async () => {
    const messages = await readMailbox(mailboxPath);
    return [...messages].reverse().find((entry) =>
      !before.has(entry.id) &&
      Array.isArray(entry.to) &&
      entry.to.map((value) => String(value).toLowerCase()).includes(email),
    );
  }, `${identity} captured email`, MAIL_TIMEOUT_MS);

  const link = magicLinkFromMessage(message, new URL(baseUrl).origin);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.pathname === destination, { timeout: NAVIGATION_TIMEOUT_MS });
  assert(!page.url().includes('#') && !/[?&](?:token|code|state)=/i.test(page.url()), `${identity} credentials remain in the visible URL`);
  await page.locator('[data-pilot-nav] button').waitFor({ state: 'visible' });
  assert(new URL(page.url()).pathname === destination, `${identity} session did not remain on its role destination`);
}

function expectedAnonymousSessionProbe401(message) {
  if (message.type() !== 'error' || !/\b401\b/.test(message.text())) return false;
  const source = message.location().url;
  if (!source) return false;
  try {
    const url = new URL(source);
    return url.pathname === `${API_ROOT}/session` && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function registerExpectedResourceConsoleError(page, status, resourceUrl) {
  const entries = expectedResourceConsoleErrors.get(page) ?? [];
  entries.push({ status, resourceUrl: new URL(resourceUrl).toString() });
  expectedResourceConsoleErrors.set(page, entries);
}

function consumeExpectedResourceConsoleError(page, message) {
  if (message.type() !== 'error') return false;
  const source = message.location().url;
  if (!source) return false;
  let resourceUrl;
  try {
    resourceUrl = new URL(source).toString();
  } catch {
    return false;
  }
  const entries = expectedResourceConsoleErrors.get(page) ?? [];
  const index = entries.findIndex((entry) => entry.resourceUrl === resourceUrl && new RegExp(`\\b${entry.status}\\b`).test(message.text()));
  if (index === -1) return false;
  entries.splice(index, 1);
  return true;
}

function attachBrowserErrorCapture(page, label, errors, redact) {
  page.on('console', (message) => {
    if (expectedAnonymousSessionProbe401(message)) return;
    if (consumeExpectedResourceConsoleError(page, message)) return;
    if (message.type() === 'error') errors.push(`${label} console: ${redact(message.text())}`);
  });
  page.on('pageerror', (error) => errors.push(`${label} page: ${redact(error.message)}`));
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (request.failure()?.errorText.includes('ERR_ABORTED')) return;
    errors.push(`${label} request: ${request.method()} ${url.origin}${url.pathname}`);
  });
}

async function assertRendered(page, label, minimumText = 80) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts?.ready);
  const result = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    text: document.body.innerText.replace(/\s+/g, ' ').trim(),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert(result.heading.length >= 3, `${label} has no meaningful h1`);
  assert(result.text.length >= minimumText, `${label} has too little rendered text`);
  assert(!/\b(?:undefined|null|\[object Object\])\b/.test(result.text), `${label} renders a placeholder value`);
  assert(result.scrollWidth <= result.clientWidth + 1, `${label} overflows horizontally (${result.scrollWidth}px > ${result.clientWidth}px)`);
}

async function browserStorageSummary(page) {
  return page.evaluate(() => {
    const tokenPattern = /(?:token|session|auth|bearer|jwt)/i;
    const tokenValuePattern = /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]{48,})/;
    const inspect = (storage) => {
      let suspiciousKeys = 0;
      let suspiciousValues = 0;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? '';
        const value = storage.getItem(key) ?? '';
        if (tokenPattern.test(key)) suspiciousKeys += 1;
        if (tokenValuePattern.test(value)) suspiciousValues += 1;
      }
      return { length: storage.length, suspiciousKeys, suspiciousValues };
    };
    return {
      local: inspect(localStorage),
      session: inspect(sessionStorage),
      scriptCookiePresent: document.cookie.split(';').some((entry) => entry.trim().startsWith('polis_pilot_session=')),
    };
  });
}

async function assertSessionSecurity(context, page, identity, baseUrl) {
  const cookies = await context.cookies(`${baseUrl}/pilot/vrsar/`);
  const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
  assert(session, `${identity} has no session cookie`);
  assert(session.httpOnly === true, `${identity} session cookie is not HttpOnly`);
  assert(session.sameSite === 'Lax', `${identity} session cookie is not SameSite=Lax`);
  assert(session.path === '/pilot/vrsar', `${identity} session cookie has the wrong path`);
  const storage = await browserStorageSummary(page);
  assert(storage.local.suspiciousKeys === 0 && storage.local.suspiciousValues === 0, `${identity} exposes a token in localStorage`);
  assert(storage.session.suspiciousKeys === 0 && storage.session.suspiciousValues === 0, `${identity} exposes a token in sessionStorage`);
  assert(storage.scriptCookiePresent === false, `${identity} session cookie is visible to page scripts`);
}

async function apiRequest(context, baseUrl, apiPath, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await context.request.fetch(`${baseUrl}${API_ROOT}${apiPath}`, {
    method: options.method ?? 'GET',
    headers,
    data: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeout: DEFAULT_TIMEOUT_MS,
    failOnStatusCode: false,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status(), headers: response.headers(), body };
}

function assertSafeError(response, expectedStatus, expectedCodes, privateValues, label) {
  assert(response.status === expectedStatus, `${label} returned ${response.status}, expected ${expectedStatus}`);
  assert(response.body && typeof response.body === 'object', `${label} did not return a JSON error`);
  assert(expectedCodes.includes(response.body.error), `${label} returned unexpected error code ${String(response.body.error)}`);
  assert(
    typeof response.body.message === 'string' && response.body.message.trim().length >= 8 && response.body.message.length <= 500,
    `${label} did not return a safe useful message`,
  );
  const serialized = JSON.stringify(response.body);
  assert(!containsAny(serialized, privateValues), `${label} error leaked private fixture material`);
  assert(!/(sessionToken|magicToken|polis_pilot_session)/i.test(serialized), `${label} error exposed a token field`);
  const cacheControl = response.headers['cache-control'] ?? '';
  assert(cacheControl.includes('no-store'), `${label} error is missing Cache-Control: no-store`);
}

function recordsFromEnvelope(response, label) {
  assert(response.status === 200, `${label} returned ${response.status}`);
  assert(response.body && Array.isArray(response.body.records), `${label} did not return a records envelope`);
  return response.body.records;
}

function recordFromEnvelope(response, label) {
  assert(response.status === 200, `${label} returned ${response.status}`);
  assert(response.body && response.body.record && typeof response.body.record === 'object', `${label} did not return a record envelope`);
  return response.body.record;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function independentReceiptHash(record) {
  const material = Object.fromEntries(RECEIPT_HASH_KEYS.map((key) => [key, record[key]]));
  return createHash('sha256').update(canonicalJson(material), 'utf8').digest('hex');
}

function assertReceiptHash(record, label) {
  for (const key of RECEIPT_HASH_KEYS) assert(Object.hasOwn(record, key), `${label} is missing receipt hash field ${key}`);
  assert(/^[a-f0-9]{64}$/.test(record.receiptHash), `${label} receipt hash is not lowercase SHA-256 hex`);
  assert(independentReceiptHash(record) === record.receiptHash, `${label} receipt hash does not match independent canonical JSON recomputation`);
  const altered = structuredClone(record);
  altered.publicSummary = `${altered.publicSummary} altered`;
  assert(independentReceiptHash(altered) !== record.receiptHash, `${label} receipt hash still verifies after altering a public field`);
}

function assertPublicShape(record, privateValues, label, expectedStatus) {
  assert(record.status === expectedStatus, `${label} status is ${String(record.status)}, expected ${expectedStatus}`);
  assert(record.testEnvironment === true, `${label} is not marked as fixture-only`);
  const unexpected = Object.keys(record).filter((key) => !PRIVATE_PUBLIC_KEYS.has(key));
  assert(unexpected.length === 0, `${label} exposes unexpected public fields: ${unexpected.join(', ')}`);
  assert(Array.isArray(record.events), `${label} events are not a list`);
  const expectedEvents = expectedStatus === 'resolved'
    ? PUBLIC_EVENT_MILESTONES
    : PUBLIC_EVENT_MILESTONES.slice(0, 5);
  assert(record.events.length === expectedEvents.length, `${label} exposes ${record.events.length} public milestones, expected ${expectedEvents.length}`);
  for (const [index, event] of record.events.entries()) {
    const keys = Object.keys(event);
    assert(
      keys.length === PUBLIC_EVENT_KEYS.size && keys.every((key) => PUBLIC_EVENT_KEYS.has(key)),
      `${label} public milestone ${index + 1} does not have the exact four public fields`,
    );
    const expected = expectedEvents[index];
    assert(
      event.stage === expected.stage &&
        event.action === expected.action &&
        event.actorRole === expected.actorRole,
      `${label} public milestone ${index + 1} is not an allowed stage/action/role tuple`,
    );
    assert(
      typeof event.createdAt === 'string' && !Number.isNaN(Date.parse(event.createdAt)),
      `${label} public milestone ${index + 1} has an invalid timestamp`,
    );
  }
  const serialized = JSON.stringify(record);
  assert(!containsAny(serialized, privateValues), `${label} leaked private fixture material`);
  assert(
    !/"(?:ownerActorId|actorId|contactEmail|contact|attachments|subject|narrative|location|payload|note|email|source|data)"\s*:/i.test(serialized),
    `${label} leaked a private field name`,
  );
  assertReceiptHash(record, label);
}

async function assertPublicDomSafe(page, privateValues, expectedStatus, label) {
  await page.locator('[data-public-receipt]').waitFor({ state: 'visible' });
  await page.locator(`.pilot-receipt-header [data-status="${expectedStatus}"]`).waitFor({ state: 'visible' });
  const dom = await page.locator('body').textContent();
  const visible = await page.locator('body').innerText();
  assert(!containsAny(dom, privateValues), `${label} DOM contains private fixture material`);
  assert(!containsAny(visible, privateValues), `${label} visible text contains private fixture material`);
  await page.emulateMedia({ media: 'print' });
  const printText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const visible = [];
    let node = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement) {
        const style = getComputedStyle(node);
        if (style.display !== 'none' && style.visibility !== 'hidden' && node.children.length === 0) {
          const text = node.innerText.trim();
          if (text) visible.push(text);
        }
      }
      node = walker.nextNode();
    }
    return visible.join(' ');
  });
  assert(!containsAny(printText, privateValues), `${label} print view contains private fixture material`);
  await page.emulateMedia({ media: 'screen' });
}

async function waitForWorkspace(page, kind) {
  await page.locator(`[data-${kind}-workspace]`).waitFor({ state: 'visible', timeout: NAVIGATION_TIMEOUT_MS });
}

async function selectQueueRecord(page, recordId, kind) {
  await waitForWorkspace(page, kind);
  const row = page.locator('[data-record-list] .pilot-ledger-row').filter({ hasText: recordId }).first();
  await row.waitFor({ state: 'visible', timeout: NAVIGATION_TIMEOUT_MS });
  await row.click();
  await waitUntil(async () => {
    const text = await page.locator('[data-record-detail]').textContent();
    return text?.includes(recordId);
  }, `${kind} record detail`);
}

async function waitForStatus(page, scopeSelector, status) {
  await page.locator(`${scopeSelector} [data-status="${status}"]`).first().waitFor({ state: 'visible', timeout: NAVIGATION_TIMEOUT_MS });
}

async function officialVersion(page) {
  const text = await page.locator('[data-record-detail] .pilot-meta > div:last-child dd').innerText();
  const version = Number(text.trim());
  assert(Number.isInteger(version) && version >= 0, 'official detail did not expose a numeric record version');
  return version;
}

async function loadOfficialRecord(page, baseUrl, recordId, expectedStatus) {
  await page.goto(`${baseUrl}/pilot/vrsar/staff?lang=en`, { waitUntil: 'domcontentloaded' });
  await selectQueueRecord(page, recordId, 'staff');
  await waitForStatus(page, '[data-record-detail]', expectedStatus);
}

async function loadReviewerRecord(page, baseUrl, recordId, expectedStatus) {
  await page.goto(`${baseUrl}/pilot/vrsar/review?lang=en`, { waitUntil: 'domcontentloaded' });
  await selectQueueRecord(page, recordId, 'review');
  await waitForStatus(page, '[data-record-detail]', expectedStatus);
}

async function submitReviewerDecision(page, decision, note, recordId) {
  const form = page.locator('[data-review-actions] form').first();
  await form.waitFor({ state: 'visible' });
  const noteField = form.locator(`textarea#review-note-${recordId}`);
  if (note) await noteField.fill(note);
  if (decision === 'accept') await form.locator('input[type="checkbox"]').check();
  await form.locator(`button[value="${decision}"]`).click();
  await waitUntil(async () => {
    const count = await page.locator('[data-record-list] .pilot-ledger-row').filter({ hasText: recordId }).count();
    return count === 0;
  }, `review ${decision} completion`, NAVIGATION_TIMEOUT_MS);
}

async function assertPublicListExcludes(context, baseUrl, recordId, label) {
  const list = await apiRequest(context, baseUrl, '/public/records');
  const records = recordsFromEnvelope(list, label);
  assert(!records.some((record) => record?.id === recordId), `${label} includes the unreviewed record`);
}

async function assertKeyboardAndReducedMotion(page) {
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  assert(reduced, 'phone context did not apply reduced-motion preference');
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const focused = [];
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
        visible: box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      };
    });
    if (result?.visible && result.text) focused.push(`${result.tag}:${result.text}`);
  }
  assert(focused.length >= 3, 'keyboard traversal did not reach three visible named controls');
  assert(new Set(focused).size >= 3, 'keyboard traversal remained on one control');
  const activeAnimations = await page.evaluate(() =>
    document.getAnimations().filter((animation) => animation.playState === 'running').length,
  );
  assert(activeAnimations === 0, 'reduced-motion page has a running animation');
}

async function assertLanguageSwitching(page, baseUrl, recordId) {
  await page.goto(`${baseUrl}/pilot/vrsar/receipts/${encodeURIComponent(recordId)}?lang=en`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-public-receipt]').waitFor({ state: 'visible' });
  for (const language of ['hr', 'it', 'en']) {
    await page.locator(`.pilot-language a[lang="${language}"]`).click();
    await page.waitForURL((url) => url.searchParams.get('lang') === language);
    assert(await page.locator('html').getAttribute('lang') === language, `${language.toUpperCase()} switch did not update the document language`);
    const boundary = normalizedText(await page.locator('.pilot-boundary').innerText());
    assert(boundary.length >= 40, `${language.toUpperCase()} boundary copy is missing`);
    await page.locator('[data-public-receipt]').waitFor({ state: 'visible' });
    await assertRendered(page, `${language.toUpperCase()} phone receipt`, 120);
  }
}

async function writeReport(outputDir, report) {
  const reportPath = path.join(outputDir, 'vrsar-acceptance-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(reportPath, 0o600);
  return reportPath;
}

const args = parseArgs(process.argv.slice(2));
if (args.has('help')) {
  console.log(usage());
  process.exit(0);
}

const startedAt = new Date();
const runId = randomUUID().slice(0, 8);
const privateFixture = {
  subject: `PRIVATE-SUBJECT-${runId}`,
  narrative: `PRIVATE-NARRATIVE-${runId}: fictional lamp fault observed only in this controlled test.`,
  location: `PRIVATE-LOCATION-${runId}`,
  contact: CONTROLLED_IDENTITIES.resident,
  attachmentName: `private-upload-${runId}.txt`,
  attachmentBody: `PRIVATE-UPLOAD-BODY-${runId}`,
  commitmentReturnNote: `PRIVATE-RETURN-NOTE-${runId}`,
  resolutionReturnNote: `PRIVATE-EVIDENCE-RETURN-${runId}`,
  rejectedEvidenceNote: `UNAPPROVED-EVIDENCE-${runId}`,
};
const privateValues = Object.values(privateFixture);
const redact = redactor(privateValues);
const publicFixture = {
  firstSummary: `Synthetic lighting report summary ${runId}, draft one.`,
  firstCommitment: `Inspect the synthetic circuit and publish a test update by the stated date, draft one ${runId}.`,
  revisedSummary: `A synthetic public-lighting circuit is queued for test inspection. Reference ${runId}.`,
  revisedCommitment: `The responsible test office will inspect circuit QA-${runId} and publish the synthetic result by the due date.`,
  dueDate: '2026-12-31',
  rejectedEvidenceUrl: `https://evidence.example.test/rejected-${runId}`,
  acceptedEvidenceNote: `Independent test evidence records completion of the synthetic circuit inspection ${runId}.`,
  acceptedEvidenceUrl: `https://evidence.example.test/accepted-${runId}`,
};

const defaultOutputBase = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
const outputDir = path.resolve(args.value('output') ?? path.join(defaultOutputBase, `polis-vrsar-qa-${timestampSlug(startedAt)}`));
assert(isOutsideRepo(outputDir), 'output directory must be outside the repository');
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);

const results = new Map();
const screenshots = [];
const browserErrors = [];
let fatalFailure = null;
let browser = null;
const contexts = [];
let browserVersion = null;
let runtimePath = null;
let baseUrl = null;
let runtimePhase = 'unknown';
let recordId = null;
let watchdog;

async function check(id, operation, { fatal = true } = {}) {
  if (fatalFailure && fatal) return;
  const definition = CHECKS.find(([candidate]) => candidate === id);
  assert(definition, `unknown check ${id}`);
  const began = Date.now();
  try {
    await operation();
    results.set(id, { id, title: definition[1], status: 'passed', durationMs: Date.now() - began });
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : error);
    results.set(id, { id, title: definition[1], status: 'failed', durationMs: Date.now() - began, message });
    if (fatal) fatalFailure = { id, message };
  }
}

try {
  watchdog = setTimeout(() => {
    fatalFailure ??= { id: 'V00', message: 'acceptance run exceeded its internal 570 second bound' };
    void browser?.close().catch(() => undefined);
  }, RUN_TIMEOUT_MS);
  watchdog.unref();

  await check('V01', async () => {
    const suppliedRuntime = args.value('runtime');
    const suppliedUrl = args.value('url');
    assert(suppliedRuntime, 'use --runtime <printed-runtime-path>');
    assert(suppliedUrl, 'use --url <printed-web-url>');
    runtimePath = path.resolve(suppliedRuntime);
    const runtime = await assertOwnedRuntime(runtimePath);
    const state = await readJson(runtime.paths.state).catch(() => null);
    runtimePhase = state?.phase ?? 'unknown';
    assert(runtimePhase === 'running', `runtime phase is ${runtimePhase}, expected running`);
    const parsed = new URL(suppliedUrl);
    assert(parsed.protocol === 'http:', 'acceptance URL must use the local HTTP runtime');
    assert(isLoopback(parsed.hostname), 'acceptance URL must be loopback-only');
    assert(!parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash, 'acceptance URL must be an origin without credentials or path');
    assert(Number(parsed.port || 80) === Number(runtime.metadata.ports.web), 'acceptance URL does not match the owned runtime web port');
    baseUrl = parsed.origin;
    const readiness = await fetch(`${baseUrl}/pilot/vrsar?lang=en`, { signal: AbortSignal.timeout(5_000) });
    assert(readiness.ok, `pilot page readiness returned HTTP ${readiness.status}`);
    const html = await readiness.text();
    assert(html.includes('data-pilot="vrsar"'), 'pilot page readiness did not return the Vrsar shell');
    assert(/<meta\s+name="robots"\s+content="noindex, nofollow, noarchive"/i.test(html), 'pilot page readiness is missing its noindex boundary');
  });

  if (!fatalFailure) {
    const executablePath = path.resolve(args.value('browser') ?? chromium.executablePath());
    await access(executablePath);
    browser = await chromium.launch({ headless: true, executablePath });
    browserVersion = browser.version();

    const makeContext = async (options = {}) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        locale: 'en-GB',
        colorScheme: 'light',
        ...options,
      });
      contexts.push(context);
      return context;
    };

    const residentContext = await makeContext();
    const otherContext = await makeContext();
    const officialContext = await makeContext();
    const reviewerContext = await makeContext();
    const anonymousContext = await makeContext();
    const residentPage = await residentContext.newPage();
    const otherPage = await otherContext.newPage();
    const officialPage = await officialContext.newPage();
    const reviewerPage = await reviewerContext.newPage();
    const anonymousPage = await anonymousContext.newPage();
    for (const [page, label] of [
      [residentPage, 'resident'],
      [otherPage, 'other resident'],
      [officialPage, 'official'],
      [reviewerPage, 'reviewer'],
      [anonymousPage, 'anonymous'],
    ]) {
      page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      attachBrowserErrorCapture(page, label, browserErrors, redact);
    }

    const mailboxPath = path.join(runtimePath, 'mail', 'messages.ndjson');

    await check('V02', async () => {
      for (const [identity, page] of [
        ['resident', residentPage],
        ['other', otherPage],
        ['official', officialPage],
        ['reviewer', reviewerPage],
      ]) {
        await requestAndOpenMagicLink(
          page,
          identity,
          CONTROLLED_IDENTITIES[identity],
          ROLE_DESTINATIONS[identity],
          mailboxPath,
          baseUrl,
        );
      }
      const cookieUrl = `${baseUrl}/pilot/vrsar/`;
      assert(await residentContext.cookies(cookieUrl).then((items) => items.some((cookie) => cookie.name === SESSION_COOKIE)), 'resident did not receive a session');
      assert(await otherContext.cookies(cookieUrl).then((items) => items.some((cookie) => cookie.name === SESSION_COOKIE)), 'other resident did not receive a session');
      assert(await officialContext.cookies(cookieUrl).then((items) => items.some((cookie) => cookie.name === SESSION_COOKIE)), 'official did not receive a session');
      assert(await reviewerContext.cookies(cookieUrl).then((items) => items.some((cookie) => cookie.name === SESSION_COOKIE)), 'reviewer did not receive a session');
    });

    await check('V03', async () => {
      for (const [identity, context, page] of [
        ['resident', residentContext, residentPage],
        ['other resident', otherContext, otherPage],
        ['official', officialContext, officialPage],
        ['reviewer', reviewerContext, reviewerPage],
      ]) await assertSessionSecurity(context, page, identity, baseUrl);
    });

    await check('V04', async () => {
      await residentPage.goto(`${baseUrl}/pilot/vrsar/file?lang=en`, { waitUntil: 'domcontentloaded' });
      const form = residentPage.locator('[data-report-form]');
      await form.waitFor({ state: 'visible' });
      await assertRendered(residentPage, 'resident filing desktop', 150);
      await form.locator('#report-subject').fill(privateFixture.subject);
      await form.locator('#report-narrative').fill(privateFixture.narrative);
      await form.locator('#report-location').fill(privateFixture.location);
      await form.locator('#report-contact').fill(privateFixture.contact);
      await form.locator('#report-attachments').setInputFiles({
        name: privateFixture.attachmentName,
        mimeType: 'text/plain',
        buffer: Buffer.from(privateFixture.attachmentBody),
      });
      await form.locator('[data-report-submit]').click();
      await residentPage.waitForURL((url) => /^\/pilot\/vrsar\/cases\/[^/]+$/.test(url.pathname), { timeout: NAVIGATION_TIMEOUT_MS });
      recordId = decodeURIComponent(new URL(residentPage.url()).pathname.split('/').filter(Boolean).at(-1));
      assert(/^[A-Za-z0-9_-]{1,128}$/.test(recordId), 'filed record returned an invalid identifier');
      await residentPage.locator('[data-private-record]').waitFor({ state: 'visible' });
      const privateText = await residentPage.locator('[data-private-record]').innerText();
      assert(privateText.includes(privateFixture.subject), 'resident private detail omitted the subject');
      assert(privateText.includes(privateFixture.narrative), 'resident private detail omitted the narrative');
      assert(privateText.includes(privateFixture.location), 'resident private detail omitted the location marker');
      assert(privateText.includes(privateFixture.attachmentName), 'resident private detail omitted the upload receipt');
      await waitForStatus(residentPage, '[data-private-record]', 'open');
    });

    await check('V05', async () => {
      const detail = await apiRequest(anonymousContext, baseUrl, `/public/records/${encodeURIComponent(recordId)}`);
      assertSafeError(detail, 404, ['public_record_not_found', 'not_found'], privateValues, 'unreviewed public detail');
      await assertPublicListExcludes(anonymousContext, baseUrl, recordId, 'unreviewed public list');
      await anonymousPage.goto(`${baseUrl}/pilot/vrsar/receipts?lang=en`, { waitUntil: 'domcontentloaded' });
      await waitUntil(async () => {
        const loading = await anonymousPage.locator('[data-page-state]').innerText();
        return !loading.includes('Loading');
      }, 'public receipt list');
      const listText = await anonymousPage.locator('body').textContent();
      assert(!listText.includes(recordId), 'unreviewed record appears in the public receipt DOM');
      assert(!containsAny(listText, privateValues), 'unreviewed public list leaked private fixture material');
    });

    await check('V06', async () => {
      const response = await apiRequest(otherContext, baseUrl, `/records/${encodeURIComponent(recordId)}`);
      assertSafeError(response, 404, ['record_not_found', 'not_found'], privateValues, 'second resident private read');
      registerExpectedResourceConsoleError(
        otherPage,
        404,
        `${baseUrl}${API_ROOT}/records/${encodeURIComponent(recordId)}`,
      );
      await otherPage.goto(`${baseUrl}/pilot/vrsar/cases/${encodeURIComponent(recordId)}?lang=en`, { waitUntil: 'domcontentloaded' });
      await otherPage.locator('[data-page-state][data-tone="error"]').waitFor({ state: 'visible' });
      const body = await otherPage.locator('body').textContent();
      assert(!containsAny(body, privateValues), 'second resident page leaked the first resident private material');
      assert(await otherPage.locator('[data-private-record]').isHidden(), 'second resident private panel became visible');
    });

    await check('V07', async () => {
      await loadOfficialRecord(officialPage, baseUrl, recordId, 'open');
      const expectedVersion = await officialVersion(officialPage);
      const requestBody = { expectedVersion };
      const missing = await apiRequest(officialContext, baseUrl, `/records/${encodeURIComponent(recordId)}/assign`, {
        method: 'POST',
        body: requestBody,
        headers: { 'idempotency-key': randomUUID() },
      });
      assertSafeError(missing, 403, ['invalid_origin'], privateValues, 'missing-origin write');
      const foreign = await apiRequest(officialContext, baseUrl, `/records/${encodeURIComponent(recordId)}/assign`, {
        method: 'POST',
        body: requestBody,
        headers: { origin: 'https://qa.invalid', 'idempotency-key': randomUUID() },
      });
      assertSafeError(foreign, 403, ['invalid_origin'], privateValues, 'foreign-origin write');
      await officialPage.reload({ waitUntil: 'domcontentloaded' });
      await selectQueueRecord(officialPage, recordId, 'staff');
      await waitForStatus(officialPage, '[data-record-detail]', 'open');
    });

    await check('V08', async () => {
      await assertRendered(officialPage, 'official desktop queue', 150);
      const assign = officialPage.locator('[data-staff-actions] button.btn[data-variant="primary"]').first();
      await assign.waitFor({ state: 'visible' });
      await assign.click();
      await waitForStatus(officialPage, '[data-record-detail]', 'assigned');
      const summary = officialPage.locator(`#staff-summary-${recordId}`);
      await summary.waitFor({ state: 'visible' });
      await summary.fill(publicFixture.firstSummary);
      await officialPage.locator(`#staff-commitment-${recordId}`).fill(publicFixture.firstCommitment);
      await officialPage.locator(`#staff-due-${recordId}`).fill(publicFixture.dueDate);
      await summary.locator('xpath=ancestor::form').locator('button[type="submit"]').click();
      await waitForStatus(officialPage, '[data-record-detail]', 'commitment-pending-review');
    });

    await check('V09', async () => {
      const expectedVersion = await officialVersion(officialPage);
      const response = await apiRequest(officialContext, baseUrl, `/records/${encodeURIComponent(recordId)}/review`, {
        method: 'POST',
        body: { expectedVersion, decision: 'accept', note: '' },
        headers: { origin: new URL(baseUrl).origin, 'idempotency-key': randomUUID() },
      });
      assertSafeError(response, 403, ['forbidden'], privateValues, 'official review attempt');
      await officialPage.reload({ waitUntil: 'domcontentloaded' });
      await selectQueueRecord(officialPage, recordId, 'staff');
      await waitForStatus(officialPage, '[data-record-detail]', 'commitment-pending-review');
    });

    await check('V10', async () => {
      await loadReviewerRecord(reviewerPage, baseUrl, recordId, 'commitment-pending-review');
      await assertRendered(reviewerPage, 'reviewer desktop queue', 150);
      await submitReviewerDecision(reviewerPage, 'return', privateFixture.commitmentReturnNote, recordId);

      await loadOfficialRecord(officialPage, baseUrl, recordId, 'returned');
      const officialText = await officialPage.locator('[data-record-detail]').innerText();
      assert(officialText.includes(privateFixture.commitmentReturnNote), 'official did not receive the private reviewer return note');
      await officialPage.locator(`#staff-summary-${recordId}`).fill(publicFixture.revisedSummary);
      await officialPage.locator(`#staff-commitment-${recordId}`).fill(publicFixture.revisedCommitment);
      await officialPage.locator(`#staff-due-${recordId}`).fill(publicFixture.dueDate);
      await officialPage.locator(`#staff-summary-${recordId}`).locator('xpath=ancestor::form').locator('button[type="submit"]').click();
      await waitForStatus(officialPage, '[data-record-detail]', 'commitment-pending-review');

      await loadReviewerRecord(reviewerPage, baseUrl, recordId, 'commitment-pending-review');
      const proposed = await reviewerPage.locator('[data-record-detail]').innerText();
      assert(proposed.includes(publicFixture.revisedSummary), 'reviewer did not receive the revised public summary');
      assert(proposed.includes(publicFixture.revisedCommitment), 'reviewer did not receive the revised commitment');
      await submitReviewerDecision(reviewerPage, 'accept', '', recordId);
    });

    await check('V11', async () => {
      const detailResponse = await apiRequest(anonymousContext, baseUrl, `/public/records/${encodeURIComponent(recordId)}`);
      const publicRecord = recordFromEnvelope(detailResponse, 'published public detail');
      assertPublicShape(publicRecord, privateValues, 'published public detail', 'published');
      assert(publicRecord.publicSummary === publicFixture.revisedSummary, 'published record does not use the reviewed revised summary');
      assert(publicRecord.commitment === publicFixture.revisedCommitment, 'published record does not use the reviewed revised commitment');
      assert(publicRecord.evidenceNote === null || publicRecord.evidenceNote === undefined, 'published record exposes completion evidence before review');
      assert(Array.isArray(publicRecord.evidenceUrls) && publicRecord.evidenceUrls.length === 0, 'published record exposes evidence links before review');
      assert(!JSON.stringify(publicRecord).includes(publicFixture.firstSummary), 'returned summary appears in the public record');
      assert(!JSON.stringify(publicRecord).includes(publicFixture.firstCommitment), 'returned commitment appears in the public record');

      await anonymousPage.goto(`${baseUrl}/pilot/vrsar/receipts/${encodeURIComponent(recordId)}?lang=en`, { waitUntil: 'domcontentloaded' });
      await assertPublicDomSafe(anonymousPage, privateValues, 'published', 'published public receipt');
      const note = normalizedText(await anonymousPage.locator('[data-public-status-note]').innerText());
      assert(/does not claim the repair is complete/i.test(note), 'published receipt does not distinguish publication from completed work');
      assert(await anonymousPage.locator('[data-public-evidence-section]').isHidden(), 'published receipt shows unapproved completion evidence');
      await assertRendered(anonymousPage, 'published desktop receipt', 150);
    });

    await check('V12', async () => {
      await loadOfficialRecord(officialPage, baseUrl, recordId, 'published');
      await officialPage.locator(`#staff-evidence-${recordId}`).fill(privateFixture.rejectedEvidenceNote);
      await officialPage.locator(`#staff-evidence-urls-${recordId}`).fill(publicFixture.rejectedEvidenceUrl);
      await officialPage.locator(`#staff-evidence-${recordId}`).locator('xpath=ancestor::form').locator('button[type="submit"]').click();
      await waitForStatus(officialPage, '[data-record-detail]', 'resolution-pending-review');

      const pendingPublic = recordFromEnvelope(
        await apiRequest(anonymousContext, baseUrl, `/public/records/${encodeURIComponent(recordId)}`),
        'resolution-pending public detail',
      );
      assertPublicShape(pendingPublic, privateValues, 'resolution-pending public detail', 'published');
      assert(!JSON.stringify(pendingPublic).includes(publicFixture.rejectedEvidenceUrl), 'unreviewed evidence URL appears publicly');

      await loadReviewerRecord(reviewerPage, baseUrl, recordId, 'resolution-pending-review');
      await submitReviewerDecision(reviewerPage, 'return', privateFixture.resolutionReturnNote, recordId);

      const returnedPublic = recordFromEnvelope(
        await apiRequest(anonymousContext, baseUrl, `/public/records/${encodeURIComponent(recordId)}`),
        'returned-resolution public detail',
      );
      assertPublicShape(returnedPublic, privateValues, 'returned-resolution public detail', 'published');
      assert(!JSON.stringify(returnedPublic).includes(publicFixture.rejectedEvidenceUrl), 'returned evidence URL appears publicly');

      await loadOfficialRecord(officialPage, baseUrl, recordId, 'published');
      const returnedDetail = await officialPage.locator('[data-record-detail]').innerText();
      assert(returnedDetail.includes(privateFixture.resolutionReturnNote), 'official did not receive the private evidence return note');
      await officialPage.locator(`#staff-evidence-${recordId}`).fill(publicFixture.acceptedEvidenceNote);
      await officialPage.locator(`#staff-evidence-urls-${recordId}`).fill(publicFixture.acceptedEvidenceUrl);
      await officialPage.locator(`#staff-evidence-${recordId}`).locator('xpath=ancestor::form').locator('button[type="submit"]').click();
      await waitForStatus(officialPage, '[data-record-detail]', 'resolution-pending-review');

      await loadReviewerRecord(reviewerPage, baseUrl, recordId, 'resolution-pending-review');
      const evidence = await reviewerPage.locator('[data-record-detail]').innerText();
      assert(evidence.includes(publicFixture.acceptedEvidenceNote), 'reviewer did not receive revised completion evidence');
      assert(evidence.includes(publicFixture.acceptedEvidenceUrl), 'reviewer did not receive the revised evidence URL');
      await submitReviewerDecision(reviewerPage, 'accept', '', recordId);
    });

    await check('V13', async () => {
      const response = await apiRequest(anonymousContext, baseUrl, `/public/records/${encodeURIComponent(recordId)}`);
      const publicRecord = recordFromEnvelope(response, 'resolved public detail');
      assertPublicShape(publicRecord, privateValues, 'resolved public detail', 'resolved');
      assert(publicRecord.evidenceNote === publicFixture.acceptedEvidenceNote, 'resolved record omitted the accepted evidence note');
      assert(publicRecord.evidenceUrls?.includes(publicFixture.acceptedEvidenceUrl), 'resolved record omitted the accepted evidence URL');
      assert(!JSON.stringify(publicRecord).includes(publicFixture.rejectedEvidenceUrl), 'returned evidence URL appears in resolved public JSON');
      assert(!JSON.stringify(publicRecord).includes(publicFixture.firstSummary), 'returned commitment draft appears in resolved public JSON');

      const list = recordsFromEnvelope(await apiRequest(anonymousContext, baseUrl, '/public/records'), 'resolved public list');
      const listed = list.find((record) => record?.id === recordId);
      assert(listed, 'resolved record is missing from the public list');
      assertPublicShape(listed, privateValues, 'resolved public list record', 'resolved');

      await anonymousPage.goto(`${baseUrl}/pilot/vrsar/receipts/${encodeURIComponent(recordId)}?lang=en`, { waitUntil: 'domcontentloaded' });
      await assertPublicDomSafe(anonymousPage, privateValues, 'resolved', 'resolved public receipt');
      const body = await anonymousPage.locator('body').textContent();
      assert(body.includes(publicFixture.acceptedEvidenceNote), 'resolved public DOM omitted accepted evidence');
      assert(body.includes(publicFixture.acceptedEvidenceUrl), 'resolved public DOM omitted accepted evidence link');
      assert(!body.includes(publicFixture.rejectedEvidenceUrl), 'resolved public DOM contains returned evidence');
      await assertRendered(anonymousPage, 'resolved desktop receipt', 180);
    });

    let mobileContext;
    let mobilePage;
    await check('V14', async () => {
      mobileContext = await makeContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
      });
      mobilePage = await mobileContext.newPage();
      mobilePage.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
      mobilePage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      attachBrowserErrorCapture(mobilePage, 'anonymous phone', browserErrors, redact);
      await assertLanguageSwitching(mobilePage, baseUrl, recordId);
      await assertKeyboardAndReducedMotion(mobilePage);
      await assertRendered(anonymousPage, 'resolved desktop receipt', 180);
    });

    await check('V15', async () => {
      await residentPage.goto(`${baseUrl}/pilot/vrsar/cases/${encodeURIComponent(recordId)}?lang=en`, { waitUntil: 'domcontentloaded' });
      await residentPage.locator('[data-private-record]').waitFor({ state: 'visible' });
      await waitForStatus(residentPage, '[data-private-record]', 'resolved');
      await residentPage.reload({ waitUntil: 'domcontentloaded' });
      await residentPage.locator('[data-private-record]').waitFor({ state: 'visible' });
      await waitForStatus(residentPage, '[data-private-record]', 'resolved');
      const privateText = await residentPage.locator('[data-private-record]').innerText();
      assert(privateText.includes(privateFixture.subject), 'resident refresh lost private subject access');
      assert(privateText.includes(privateFixture.attachmentName), 'resident refresh lost private attachment access');

      await loadOfficialRecord(officialPage, baseUrl, recordId, 'resolved');
      await officialPage.reload({ waitUntil: 'domcontentloaded' });
      await selectQueueRecord(officialPage, recordId, 'staff');
      await waitForStatus(officialPage, '[data-record-detail]', 'resolved');

      await reviewerPage.goto(`${baseUrl}/pilot/vrsar/review?lang=en`, { waitUntil: 'domcontentloaded' });
      await waitForWorkspace(reviewerPage, 'review');
      assert(await reviewerPage.locator('[data-record-list] .pilot-ledger-row').filter({ hasText: recordId }).count() === 0, 'resolved record remains in reviewer pending queue');

      await mobilePage.reload({ waitUntil: 'domcontentloaded' });
      await mobilePage.locator('[data-public-receipt]').waitFor({ state: 'visible' });
      await waitForStatus(mobilePage, '[data-public-receipt]', 'resolved');
    });

    await check('V16', async () => {
      const cookieUrl = `${baseUrl}/pilot/vrsar/`;
      const oldCookie = (await residentContext.cookies(cookieUrl)).find((cookie) => cookie.name === SESSION_COOKIE);
      assert(oldCookie, 'resident old session cookie was unavailable for revocation proof');
      await residentPage.locator('[data-pilot-nav] button').waitFor({ state: 'visible' });
      await residentPage.locator('[data-pilot-nav] button').click();
      await residentPage.waitForURL((url) => url.pathname === '/pilot/vrsar/login', { timeout: NAVIGATION_TIMEOUT_MS });
      assert(!(await residentContext.cookies(cookieUrl)).some((cookie) => cookie.name === SESSION_COOKIE), 'logout did not clear the browser session cookie');
      const afterLogout = await apiRequest(residentContext, baseUrl, `/records/${encodeURIComponent(recordId)}`);
      assertSafeError(afterLogout, 401, ['unauthorized', 'unauthenticated', 'invalid_session'], privateValues, 'logged-out private read');

      await residentContext.addCookies([{
        name: SESSION_COOKIE,
        value: oldCookie.value,
        domain: new URL(baseUrl).hostname,
        path: '/pilot/vrsar',
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      }]);
      const replay = await apiRequest(residentContext, baseUrl, `/records/${encodeURIComponent(recordId)}`);
      assertSafeError(replay, 401, ['unauthorized', 'unauthenticated', 'invalid_session'], privateValues, 'revoked-session replay');
      await residentContext.clearCookies();
    });

    if (!fatalFailure && args.has('skip-screenshots')) {
      const definition = CHECKS.find(([id]) => id === 'V18');
      results.set('V18', {
        id: 'V18',
        title: definition[1],
        status: 'unrun',
        durationMs: 0,
        message: 'skipped by --skip-screenshots for a functional rerun',
      });
    } else if (!fatalFailure) {
      await check('V18', async () => {
        await anonymousPage.goto(`${baseUrl}/pilot/vrsar/receipts/${encodeURIComponent(recordId)}?lang=en`, { waitUntil: 'domcontentloaded' });
        await assertPublicDomSafe(anonymousPage, privateValues, 'resolved', 'desktop screenshot receipt');
        const desktopPath = path.join(outputDir, 'vrsar-resolved-desktop-1440x1000.png');
        await anonymousPage.screenshot({ path: desktopPath, fullPage: true });
        screenshots.push({ id: 'resolved-desktop', viewport: { width: 1440, height: 1000 }, language: 'en', path: desktopPath });

        await mobilePage.goto(`${baseUrl}/pilot/vrsar/receipts/${encodeURIComponent(recordId)}?lang=hr`, { waitUntil: 'domcontentloaded' });
        await assertPublicDomSafe(mobilePage, privateValues, 'resolved', 'phone screenshot receipt');
        const mobilePath = path.join(outputDir, 'vrsar-resolved-phone-390x844.png');
        await mobilePage.screenshot({ path: mobilePath, fullPage: true });
        screenshots.push({ id: 'resolved-phone', viewport: { width: 390, height: 844 }, language: 'hr', path: mobilePath });
      }, { fatal: false });
    }

    await check('V17', async () => {
      assert(browserErrors.length === 0, browserErrors.length ? browserErrors.slice(0, 5).join(' | ') : 'browser errors were recorded');
    }, { fatal: false });
  }
} catch (error) {
  const message = redact(error instanceof Error ? error.message : error);
  fatalFailure ??= { id: 'V00', message };
} finally {
  clearTimeout(watchdog);
  for (const context of contexts.reverse()) await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

for (const [id, title] of CHECKS) {
  if (!results.has(id)) {
    results.set(id, {
      id,
      title,
      status: 'unrun',
      durationMs: 0,
      message: fatalFailure ? `blocked by ${fatalFailure.id}` : 'not reached',
    });
  }
}

const checks = CHECKS.map(([id]) => results.get(id));
const summary = checks.reduce(
  (accumulator, item) => {
    accumulator[item.status] += 1;
    return accumulator;
  },
  { passed: 0, failed: 0, unrun: 0 },
);
const report = {
  schemaVersion: 1,
  kind: 'polis-vrsar-browser-acceptance',
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: summary.failed === 0 && !fatalFailure ? 'passed' : 'failed',
  scope: {
    fixtureOnly: true,
    municipalityAuthorization: false,
    controlledIdentityCount: 4,
    positiveJourneyDriver: 'browser DOM',
    apiUse: 'negative-path and privacy/security assertions only',
    humanUsabilityOutcome: 'unrun',
    note: 'This run records automated fixture behavior only. It does not invent or claim human usability findings.',
  },
  runtime: {
    path: runtimePath,
    url: baseUrl,
    phase: runtimePhase,
    loopbackOnly: baseUrl ? isLoopback(new URL(baseUrl).hostname) : null,
  },
  browser: {
    engine: 'chromium',
    version: browserVersion,
    headless: true,
    hardTimeoutCommand: 'bun scripts/run-with-timeout.mjs 600 -- bun scripts/vrsar-acceptance.mjs --runtime <path> --url <url>',
  },
  summary,
  checks,
  screenshots,
};
const reportPath = await writeReport(outputDir, report);
console.log(JSON.stringify({ status: report.status, summary, reportPath, screenshotCount: screenshots.length }, null, 2));
if (report.status !== 'passed') process.exitCode = 1;

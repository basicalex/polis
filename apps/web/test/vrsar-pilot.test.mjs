import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { actionLabels, errorMessages, statusLabels, translatedAction } from '../src/content/pilot/vrsar.ts';
import { createPrivateRecord, PilotApiError } from '../src/lib/pilot/vrsar/api.ts';
import { latestTraceEvent } from '../src/lib/pilot/vrsar/model.ts';
import {
  clearSessionCookie,
  handlePilotProxy,
  resolvePilotBackend,
  sessionCookie,
  shouldSecureSessionCookie,
} from '../src/lib/pilot/vrsar/proxy.ts';

const webRoot = new URL('../', import.meta.url);
const pagesRoot = new URL('../src/pages/pilot/vrsar/', import.meta.url);

async function exists(relative) {
  await access(new URL(relative, pagesRoot));
}

function proxyContext(path, {
  method = 'GET',
  origin = 'http://localhost:4321',
  requestOrigin = method === 'POST' ? origin : undefined,
  body,
  cookie,
  idempotencyKey,
} = {}) {
  const headers = new Headers();
  if (requestOrigin) headers.set('origin', requestOrigin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  return {
    request: new Request(`${origin}/pilot/vrsar/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url: new URL(`${origin}/pilot/vrsar/api/${path}`),
    params: { path },
    locals: {},
  };
}

const key = '123e4567-e89b-42d3-a456-426614174000';

test('Vrsar pilot route set is present and isolated', async () => {
  for (const route of [
    'index.astro',
    'login.astro',
    'file.astro',
    join('cases', 'index.astro'),
    join('cases', '[caseId].astro'),
    join('staff', 'index.astro'),
    join('review', 'index.astro'),
    join('receipts', 'index.astro'),
    join('receipts', '[receiptId].astro'),
    join('api', '[...path].ts'),
  ]) await exists(route);

  for (const shared of [
    'src/components/pilot/vrsar/VrsarPilotShell.astro',
    'src/content/pilot/vrsar.ts',
    'src/lib/pilot/vrsar/api.ts',
    'src/lib/pilot/vrsar/proxy.ts',
    'src/styles/pilot/vrsar.css',
  ]) await access(new URL(shared, webRoot));
});

test('browser pilot code keeps bearer sessions out of Web Storage and uses only the BFF', async () => {
  const browserFiles = [
    'src/lib/pilot/vrsar/api.ts',
    'src/scripts/pilot/vrsar/shell.ts',
    'src/scripts/pilot/vrsar/login.ts',
    'src/scripts/pilot/vrsar/file.ts',
    'src/scripts/pilot/vrsar/cases.ts',
    'src/scripts/pilot/vrsar/case-detail.ts',
    'src/scripts/pilot/vrsar/staff.ts',
    'src/scripts/pilot/vrsar/review.ts',
    'src/scripts/pilot/vrsar/receipts.ts',
    'src/scripts/pilot/vrsar/receipt-detail.ts',
  ];
  const sources = await Promise.all(browserFiles.map((file) => readFile(new URL(file, webRoot), 'utf8')));
  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /localStorage|sessionStorage|Bearer\s|authorization\s*:/i, browserFiles[index]);
    assert.doesNotMatch(source, /api\/v1\/trace-records|window\.__API_URL/, browserFiles[index]);
  }
  assert.match(sources[0], /const API_ROOT = '\/pilot\/vrsar\/api'/);
});

test('unresolved exact commands reuse one in-memory idempotency key after a lost response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const logicalRecords = new Map();
  let attempt = 0;
  globalThis.fetch = async (_url, init) => {
    attempt += 1;
    const headers = new Headers(init?.headers);
    const idempotencyKey = headers.get('idempotency-key');
    const body = JSON.parse(String(init?.body));
    calls.push({ idempotencyKey, body });
    if (!logicalRecords.has(idempotencyKey)) {
      logicalRecords.set(idempotencyKey, {
        id: `record-${logicalRecords.size + 1}`,
        version: 1,
        ...body,
      });
    }
    if (attempt === 1) throw new TypeError('response lost after commit');
    return new Response(JSON.stringify({ record: logicalRecords.get(idempotencyKey) }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const firstCommand = {
      subject: 'Synthetic lamp report A',
      narrative: 'Synthetic narrative A',
      location: 'TEST-LOCATION-A',
    };
    await assert.rejects(
      createPrivateRecord(firstCommand),
      (error) => error instanceof PilotApiError && error.code === 'upstream_unavailable',
    );
    const retried = await createPrivateRecord(firstCommand);
    assert.equal(retried.id, 'record-1');
    assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
    assert.equal(logicalRecords.size, 1);

    const different = await createPrivateRecord({
      subject: 'Synthetic lamp report B',
      narrative: 'Synthetic narrative B',
      location: 'TEST-LOCATION-B',
    });
    assert.equal(different.id, 'record-2');
    assert.notEqual(calls[1].idempotencyKey, calls[2].idempotencyKey);
    assert.equal(logicalRecords.size, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a successful response with an invalid envelope keeps the exact command key unresolved', async () => {
  const originalFetch = globalThis.fetch;
  const keys = [];
  let attempt = 0;
  globalThis.fetch = async (_url, init) => {
    attempt += 1;
    keys.push(new Headers(init?.headers).get('idempotency-key'));
    const payload = attempt === 1
      ? { ok: true }
      : { record: { id: 'record-envelope', version: 1 } };
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  const command = {
    subject: 'Synthetic envelope report',
    narrative: 'Synthetic envelope narrative',
    location: 'TEST-LOCATION-ENVELOPE',
  };

  try {
    await assert.rejects(
      createPrivateRecord(command),
      (error) => error instanceof PilotApiError && error.code === 'invalid_response',
    );
    const retried = await createPrivateRecord(command);
    assert.equal(retried.id, 'record-envelope');
    assert.equal(keys[0], keys[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public receipt keeps one truthful trail and leads with approved wording', async () => {
  const [component, detail, list, content, astroConfig, baseStyles] = await Promise.all([
    readFile(new URL('src/components/pilot/vrsar/VrsarReceipt.astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/receipt-detail.ts', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/receipts.ts', webRoot), 'utf8'),
    readFile(new URL('src/content/pilot/vrsar.ts', webRoot), 'utf8'),
    readFile(new URL('astro.config.mjs', webRoot), 'utf8'),
    readFile(new URL('../../packages/ui/src/styles/base.css', webRoot), 'utf8'),
  ]);

  const headerIndex = component.indexOf('pilot-receipt-header');
  const approvedIndex = component.indexOf('pilot-approved-text');
  const metadataIndex = component.indexOf('<dl class="pilot-meta">');
  const disclosureIndex = component.indexOf('pilot-receipt-disclosure');
  const hashIndex = component.indexOf('data-public-hash');
  assert.ok(headerIndex < approvedIndex && approvedIndex < metadataIndex);
  assert.ok(disclosureIndex < hashIndex);
  assert.match(component, /VrsarStatusLabel status="unknown" lang=\{lang\} \/>/);
  assert.equal((component.match(/<VrsarTraceSummary/g) ?? []).length, 1);
  assert.doesNotMatch(component, /data-public-events/);
  assert.match(detail, /renderTrace\(document, record\.status, record\.events, \{ hideMissingStages: true \}\)/);
  assert.doesNotMatch(detail, /translatedAction|data-public-events/);
  assert.match(detail, /Promise\.all\(\[getPublicRecord\(id\), getPilotConfig\(\)\]\)/);
  assert.match(detail, /entityName\(config\.office, lang\)/);
  assert.match(detail, /entityName\(config\.category, lang\)/);
  assert.match(list, /Promise\.all\(\[listPublicRecords\(\), getPilotConfig\(\)\]\)/);
  assert.match(list, /entityName\(config\.office, lang\)/);
  assert.match(list, /entityName\(config\.category, lang\)/);
  assert.match(content, /interfaceLanguage: localized\('Jezik sučelja', 'Lingua dell’interfaccia', 'Interface language'\)/);
  assert.match(content, /shown exactly as accepted by independent review/);
  assert.match(astroConfig, /const pilotRuntime = Boolean\(process\.env\.PILOT_RUNTIME_DIR\?\.trim\(\)\)/);
  assert.match(astroConfig, /devToolbar: \{ enabled: !pilotRuntime \}/);
  // The status label is never boxed or filled: the shared recipe owns that.
  assert.match(baseStyles, /\.status-label,[\s\S]*?\n\}/);
  const statusRecipe = baseStyles.slice(baseStyles.indexOf('.status-label,'));
  assert.match(statusRecipe.slice(0, statusRecipe.indexOf('}')), /border: 0;[\s\S]*background: none;/);
});

test('public receipt renderers reference only the public projection vocabulary', async () => {
  const files = ['src/scripts/pilot/vrsar/receipts.ts', 'src/scripts/pilot/vrsar/receipt-detail.ts'];
  for (const file of files) {
    const source = await readFile(new URL(file, webRoot), 'utf8');
    assert.doesNotMatch(source, /\b(subject|narrative|contactEmail|attachments|location)\b/, file);
    assert.match(source, /PublicTraceRecord/);
  }
});

test('pilot copy has HR default plus Italian and English and separates publication from resolution', async () => {
  const source = await readFile(new URL('src/content/pilot/vrsar.ts', webRoot), 'utf8');
  assert.match(source, /PILOT_LANGS = \['hr', 'it', 'en'\]/);
  assert.match(source, /Općina Vrsar-Orsera/);
  assert.match(source, /Neslužbeno testno okruženje/);
  assert.match(source, /Ambiente di test non ufficiale/);
  assert.match(source, /Unofficial test environment/);
  assert.match(source, /Objavljena obveza nije dokaz izvršenog popravka/);
  assert.match(source, /resolution-pending-review/);
  assert.match(source, /resolved/);
});

test('workflow statuses and backend errors have HR, IT, and EN text', () => {
  for (const status of [
    'open',
    'assigned',
    'commitment-pending-review',
    'returned',
    'published',
    'resolution-pending-review',
    'resolved',
  ]) {
    for (const lang of ['hr', 'it', 'en']) assert.ok(statusLabels[status]?.[lang], `${status}:${lang}`);
  }
  for (const action of [
    'report-filed',
    'office-assigned',
    'commitment-filed',
    'commitment-accepted',
    'completion-approved',
    'record-created',
    'record-assigned',
    'commitment-submitted',
    'commitment-approved',
    'commitment-returned',
    'resolution-submitted',
    'resolution-approved',
    'resolution-returned',
    'attachment-added',
    'published',
    'resolved',
  ]) {
    for (const lang of ['hr', 'it', 'en']) assert.ok(actionLabels[action]?.[lang], `${action}:${lang}`);
  }
  for (const code of [
    'attachment_content_mismatch',
    'attachment_not_found',
    'authentication_required',
    'bad_gateway',
    'body_too_large',
    'email_not_verified',
    'forbidden',
    'idempotency_conflict',
    'identity_provider_unavailable',
    'intake_closed',
    'invalid_callback_payload',
    'invalid_email',
    'invalid_session',
    'invalid_state',
    'login_failed',
    'public_record_not_found',
    'rate_limited',
    'record_not_found',
    'self_review_forbidden',
    'stale_version',
    'trace_integrity_failed',
    'trace_unavailable',
    'unauthenticated',
    'upstream_timeout',
  ]) {
    for (const lang of ['hr', 'it', 'en']) assert.ok(errorMessages[code]?.[lang], `${code}:${lang}`);
  }
});

test('current public milestone actions never fall back to generic update copy', () => {
  const currentActions = [
    'report-filed',
    'office-assigned',
    'commitment-filed',
    'commitment-accepted',
    'published',
    'completion-approved',
  ];
  for (const lang of ['hr', 'it', 'en']) {
    const fallback = translatedAction('__unknown-public-action__', lang);
    for (const action of currentActions) {
      const label = translatedAction(action, lang);
      assert.ok(label, `${action}:${lang}`);
      assert.notEqual(label, fallback, `${action}:${lang}`);
    }
  }
});

test('receipt stage selects the newest public milestone without requiring a sequence', () => {
  const published = {
    stage: 'receipt',
    action: 'published',
    actorRole: 'reviewer',
    createdAt: '2026-09-05T09:00:00.000Z',
  };
  const completion = {
    stage: 'receipt',
    action: 'completion-approved',
    actorRole: 'reviewer',
    createdAt: '2026-09-05T10:00:00.000Z',
  };
  assert.deepEqual(latestTraceEvent([published], 'receipt'), published);
  assert.deepEqual(latestTraceEvent([published, completion], 'receipt'), completion);
  assert.deepEqual(
    latestTraceEvent([{ ...published, createdAt: completion.createdAt }, completion], 'receipt'),
    completion,
  );
});

test('backend resolution defaults only on loopback HTTP and rejects unsafe bases', () => {
  assert.equal(resolvePilotBackend(new URL('http://localhost:4321'), undefined), 'http://127.0.0.1:3000');
  assert.equal(resolvePilotBackend(new URL('https://example.test'), undefined), null);
  assert.equal(resolvePilotBackend(new URL('https://example.test'), 'http://remote.test'), null);
  assert.equal(resolvePilotBackend(new URL('https://example.test'), 'https://trace.internal'), 'https://trace.internal');
  assert.equal(resolvePilotBackend(new URL('https://example.test'), 'https://user:pass@trace.internal'), null);
  assert.equal(resolvePilotBackend(new URL('https://example.test'), 'https://trace.internal/path'), null);
});

test('portable proxy never reads deprecated Astro locals runtime bindings', async () => {
  const context = proxyContext('config');
  Object.defineProperty(context, 'locals', {
    configurable: true,
    get() {
      throw new Error('Astro.locals.runtime.env is deprecated');
    },
  });
  const response = await handlePilotProxy(context, {
    publicRelease: false,
    backendBase: 'https://trace.internal',
    fetchImpl: async () => new Response(JSON.stringify({ testEnvironment: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { testEnvironment: true });
});

test('pilot proxy rejects public release, missing origins, unknown endpoints, and unsupported fields', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return new Response('{}'); };
  const publicResponse = await handlePilotProxy(proxyContext('config'), {
    publicRelease: true,
    backendBase: 'https://trace.internal',
    fetchImpl,
  });
  assert.equal(publicResponse.status, 404);
  assert.equal(called, false);

  const missingOrigin = await handlePilotProxy(proxyContext('records', {
    method: 'POST',
    requestOrigin: null,
    cookie: 'polis_pilot_session=secret',
    idempotencyKey: key,
    body: { subject: 'x', narrative: 'y', location: 'z' },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(missingOrigin.status, 403);

  const mismatchedOrigin = await handlePilotProxy(proxyContext('records', {
    method: 'POST',
    requestOrigin: 'https://attacker.example',
    cookie: 'polis_pilot_session=secret',
    idempotencyKey: key,
    body: { subject: 'x', narrative: 'y', location: 'z' },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(mismatchedOrigin.status, 403);

  const unknown = await handlePilotProxy(proxyContext('anything'), {
    publicRelease: false,
    backendBase: 'https://trace.internal',
    fetchImpl,
  });
  assert.equal(unknown.status, 404);

  const authorityField = await handlePilotProxy(proxyContext('records', {
    method: 'POST',
    cookie: 'polis_pilot_session=secret',
    idempotencyKey: key,
    body: { subject: 'x', narrative: 'y', location: 'z', role: 'official' },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(authorityField.status, 400);
  assert.equal(called, false);
});

test('public and unauthenticated identity routes never forward a session cookie as Authorization', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = String(url).endsWith('/api/v1/identity/exchange')
      ? { sessionToken: 'replacement-session' }
      : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const options = { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl };

  await handlePilotProxy(proxyContext('config', {
    cookie: 'polis_pilot_session=existing-session',
  }), options);
  await handlePilotProxy(proxyContext('identity/magic-link', {
    method: 'POST',
    cookie: 'polis_pilot_session=existing-session',
    body: { email: 'test@example.test' },
  }), options);
  await handlePilotProxy(proxyContext('identity/exchange', {
    method: 'POST',
    cookie: 'polis_pilot_session=existing-session',
    body: { email: 'test@example.test', token: 'magic-token' },
  }), options);

  assert.equal(calls.length, 3);
  for (const call of calls) assert.equal(call.init.headers.get('authorization'), null, call.url);
});

test('pilot proxy forwards one allowlisted private command with server-held bearer only', async () => {
  let seenUrl = '';
  let seenInit;
  const fetchImpl = async (url, init) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(JSON.stringify({ record: { id: 'record-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'upstream=forbidden' },
    });
  };
  const response = await handlePilotProxy(proxyContext('records/record-1/assign', {
    method: 'POST',
    cookie: 'polis_pilot_session=server-token',
    idempotencyKey: key,
    body: { expectedVersion: 2 },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(seenUrl, 'https://trace.internal/api/trace/records/record-1/assign');
  assert.equal(seenInit.headers.get('authorization'), 'Bearer server-token');
  assert.equal(seenInit.headers.get('idempotency-key'), key);
  assert.deepEqual(JSON.parse(seenInit.body), { expectedVersion: 2 });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('OIDC proxy fixes the callback URI and does not accept a browser redirect target', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/authorize?')) {
      return new Response(JSON.stringify({ authorizationUrl: 'https://issuer.example/authorize?state=opaque' }), { status: 200 });
    }
    return new Response(JSON.stringify({ sessionToken: 'oidc-session' }), { status: 200 });
  };
  const authorize = await handlePilotProxy(proxyContext('identity/authorize'), {
    publicRelease: false,
    backendBase: 'https://trace.internal',
    fetchImpl,
  });
  assert.equal(authorize.status, 200);
  const authorizeUrl = new URL(calls[0].url);
  assert.equal(
    authorizeUrl.searchParams.get('redirect_uri'),
    'http://localhost:4321/pilot/vrsar/login',
  );

  const callback = await handlePilotProxy(proxyContext('identity/callback', {
    method: 'POST',
    body: { code: 'code', state: 'state' },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(callback.status, 200);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    code: 'code',
    state: 'state',
    redirectUri: 'http://localhost:4321/pilot/vrsar/login',
  });

  const spoofed = await handlePilotProxy(proxyContext('identity/callback', {
    method: 'POST',
    body: { code: 'code', state: 'state', redirectUri: 'https://attacker.example' },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(spoofed.status, 400);
});

test('identity exchange stores only an HttpOnly cookie and strips the bearer response', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    sessionToken: 'opaque-session-token',
    citizen: { id: 'actor-1', email: 'test@example.test' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const response = await handlePilotProxy(proxyContext('identity/exchange', {
    method: 'POST',
    body: { email: 'test@example.test', token: 'magic-token' },
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });
  assert.doesNotMatch(JSON.stringify(body), /opaque-session-token/);
  assert.match(response.headers.get('set-cookie') ?? '', /polis_pilot_session=opaque-session-token/);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Lax/);
});

test('cookie helpers scope the session and omit Secure only for loopback HTTP', () => {
  assert.equal(sessionCookie('token', false), 'polis_pilot_session=token; Path=/pilot/vrsar; HttpOnly; SameSite=Lax');
  assert.equal(shouldSecureSessionCookie(new URL('http://127.0.0.1:4321')), false);
  assert.equal(shouldSecureSessionCookie(new URL('http://localhost:4321')), false);
  assert.equal(shouldSecureSessionCookie(new URL('http://example.test')), true);
  assert.equal(shouldSecureSessionCookie(new URL('https://example.test')), true);
  assert.match(sessionCookie('token', true), /; Secure$/);
  assert.match(clearSessionCookie(true), /Max-Age=0; Secure$/);
});

test('logout sends an empty body with the server-held bearer and clears the cookie', async () => {
  let seenInit;
  const fetchImpl = async (_url, init) => {
    seenInit = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const response = await handlePilotProxy(proxyContext('identity/logout', {
    method: 'POST',
    cookie: 'polis_pilot_session=server-token',
  }), { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(seenInit.headers.get('authorization'), 'Bearer server-token');
  assert.equal(seenInit.body, '{}');
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

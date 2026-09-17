// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { actionLabels, errorMessages, statusLabels, translatedAction } from '../src/content/pilot/vrsar.ts';
import {
  createPrivateRecord,
  eraseText,
  fileAnonymousCase,
  noticeCase,
  PilotApiError,
} from '../src/lib/pilot/vrsar/api.ts';
import {
  ASSESSMENT_HOLD_REASONS,
  eraseResultFromEnvelope,
  HOLD_REASONS,
  latestTraceEvent,
  noticeResultFromEnvelope,
  pilotConfigFromResponse,
  TEXT_STATUSES,
} from '../src/lib/pilot/vrsar/model.ts';
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
test('publicity model and API exports carry the new controls', () => {
  assert.deepEqual([...ASSESSMENT_HOLD_REASONS], [
    'personal-data',
    'abuse',
    'off-topic',
    'other',
  ]);
  assert.deepEqual([...HOLD_REASONS], [
    'personal-data',
    'abuse',
    'off-topic',
    'other',
    'pending-release',
    'policy',
    'notices',
    'confidential',
  ]);
  assert.deepEqual([...TEXT_STATUSES], ['public', 'held', 'redacted', 'removed']);
  assert.equal(typeof eraseText, 'function');
  assert.equal(typeof noticeCase, 'function');
  assert.deepEqual(
    pilotConfigFromResponse({ municipality: {}, category: {}, office: {}, testEnvironment: true }),
    {
      municipality: {},
      category: {},
      office: {},
      testEnvironment: true,
      publicTextMode: 'open',
      publicTextRetentionDays: 730,
    },
  );
  assert.equal(
    eraseResultFromEnvelope({ case: { textStatus: 'removed', removedReason: 'filer' } }).case
      .textStatus,
    'removed',
  );
  assert.equal(noticeResultFromEnvelope({ case: { noticeCount: 3 } }).case.noticeCount, 3);
});


test('Vrsar pilot route set is present and isolated', async () => {
  for (const route of [
    'index.astro',
    'login.astro',
    'file.astro',
    join('cases', 'index.astro'),
    join('cases', '[caseId].astro'),
    join('staff', 'index.astro'),
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
    'src/scripts/pilot/vrsar/office-actions.ts',
    'src/scripts/pilot/vrsar/receipts.ts',
    'src/scripts/pilot/vrsar/receipt-detail.ts',
  ];
  const sources = await Promise.all(browserFiles.map((file) => readFile(new URL(file, webRoot), 'utf8')));
  for (const [index, source] of sources.entries()) {
    const file = browserFiles[index];
    assert.doesNotMatch(source, /sessionStorage|Bearer\s|authorization\s*:/i, file);
    assert.doesNotMatch(source, /api\/v1\/trace-records|window\.__API_URL/, file);
    // The office queue keeps the signing name and title between answers. That
    // one key is the only Web Storage in the pilot, and it holds no session.
    if (file === 'src/scripts/pilot/vrsar/office-actions.ts') {
      assert.equal((source.match(/localStorage/g) ?? []).length, 2, file);
      assert.match(source, /const SIGNATURE_KEY = 'polis\.pilot\.vrsar\.signature'/);
      assert.doesNotMatch(source, /localStorage[\s\S]{0,120}(token|session|passcode)/i, file);
    } else {
      assert.doesNotMatch(source, /localStorage/, file);
    }
  }
  assert.match(sources[0], /const API_ROOT = '\/pilot\/vrsar\/api'/);
});

test('anonymous filing helper sends an idempotent command and parses the one-time key', async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init };
    return new Response(JSON.stringify({
      case: {
        recordId: 'record-web-1',
        caseNumber: 'VRS-482113',
        reopenKey: 'private-reopen-key',
        state: 'received',
      },
      shell: { caseNumber: 'VRS-482113', state: 'received' },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const created = await fileAnonymousCase({
      text: 'Ulična rasvjeta ne radi.',
      location: 'Vrsar',
    });
    assert.deepEqual(created, {
      caseNumber: 'VRS-482113',
      reopenKey: 'private-reopen-key',
      state: 'received',
    });
    assert.equal(call.url, '/pilot/vrsar/api/public/cases');
    const headers = new Headers(call.init.headers);
    assert.match(
      headers.get('idempotency-key') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(headers.has('authorization'), false);
    assert.deepEqual(JSON.parse(String(call.init.body)), {
      text: 'Ulična rasvjeta ne radi.',
      location: 'Vrsar',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('the public case page publishes the report, the signed answer and the public check', async () => {
  const [shell, script, copy] = await Promise.all([
    readFile(new URL('src/components/pilot/vrsar/VrsarPublicShell.astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/public-case.ts', webRoot), 'utf8'),
    readFile(new URL('src/content/pilot/vrsar-public-case.ts', webRoot), 'utf8'),
  ]);

  // The report itself, its location and the hash of the original text.
  assert.match(shell, /data-case-narrative/);
  assert.match(shell, /data-case-location/);
  assert.match(shell, /data-case-text-hash/);
  assert.match(copy, /Objavljeno kako je zaprimljeno\./);

  // A held text keeps its shell and names the category that held it.
  assert.match(shell, /data-case-hold-reason/);
  assert.match(script, /translatedHoldReason\(shell\.holdReason, lang\)/);
  for (const reason of ['personal-data', 'abuse', 'off-topic', 'other']) {
    assert.ok(copy.includes(`'${reason}': localized(`) || copy.includes(`${reason}: localized(`), reason);
  }

  // The answer is signed by a person, and there is no summary to publish.
  assert.match(shell, /data-public-signed-by/);
  assert.match(script, /function signature\(record: PublicTraceRecord\)/);
  assert.doesNotMatch(shell, /data-public-summary/);
  assert.doesNotMatch(script, /publicSummary/);

  // The public checks the completion: the filer disputes, followers mark it.
  assert.match(shell, /data-dispute-form/);
  assert.match(shell, /data-dispute-list/);
  assert.match(script, /disputeCase\(caseNumber, \{ reopenKey, text: body \}\)/);
  assert.match(script, /'not-fixed'/);
  assert.match(script, /'label-appeal'/);

  // No reviewer exists, so no word on this surface may imply one.
  for (const source of [shell, script, copy]) {
    assert.doesNotMatch(source, /neovisn/i);
    assert.doesNotMatch(source, /independent review/i);
    assert.doesNotMatch(source, /provjeritelj/i);
  }
});

test('the public case page carries the removal, the notice and the erase control', async () => {
  const [shell, script, copy] = await Promise.all([
    readFile(new URL('src/components/pilot/vrsar/VrsarPublicShell.astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/public-case.ts', webRoot), 'utf8'),
    readFile(new URL('src/content/pilot/vrsar-public-case.ts', webRoot), 'utf8'),
  ]);

  // Every hold reason the model knows says something in Croatian.
  for (const reason of HOLD_REASONS) {
    assert.ok(copy.includes(`'${reason}': localized(`) || copy.includes(`${reason}: localized(`), reason);
  }
  assert.match(copy, /Tekst čeka objavu ureda\./);
  assert.match(copy, /Ova općina ne objavljuje tekst prijave\./);
  assert.match(copy, /Tekst je zadržan nakon prijava čitatelja\./);
  assert.match(copy, /Prijava je upućena povjerljivoj osobi općine\./);

  // A removed text says who removed it and that it is not coming back.
  assert.match(copy, /Tekst je uklonjen/);
  assert.match(copy, /Tekst uklonjen na zahtjev podnositelja\./);
  assert.match(copy, /Tekst uklonjen nakon isteka roka čuvanja\./);
  assert.match(copy, /Uklanjanje je trajno\. Otisak izvornog teksta ostaje javan\./);

  // The blocks and the two controls on the text.
  assert.match(shell, /data-case-removed/);
  assert.match(shell, /data-case-notice/);
  assert.match(shell, /data-case-erase/);
  assert.match(shell, /data-erase-confirm/);
  // Two taps: the confirm panel stands between the button and the removal.
  assert.ok(shell.indexOf('data-erase-open') < shell.indexOf('data-erase-confirm'));
  assert.ok(shell.indexOf('data-erase-confirm') < shell.indexOf('data-erase-go'));

  // A reader may name only the four reasons an assessment can name.
  const select = shell.slice(shell.indexOf('<select'), shell.indexOf('</select>'));
  assert.match(select, /data-notice-reason/);
  const options = shell.match(/const noticeReasons = \[([^\]]+)\]/)?.[1] ?? '';
  for (const reason of ASSESSMENT_HOLD_REASONS) assert.ok(options.includes(`'${reason}'`), reason);
  for (const reason of ['pending-release', 'policy', 'notices', 'confidential']) {
    assert.ok(!options.includes(`'${reason}'`), reason);
  }

  // The script drives both routes, and the notice count stays off the page.
  assert.match(script, /eraseText\(shell\.caseNumber, \{ reopenKey \}\)/);
  assert.match(script, /noticeCase\(caseNumber, \{/);
  assert.match(script, /removedReason/);
  assert.doesNotMatch(script, /noticeCount/);
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
  assert.match(list, /await listPublicRecords\(\)/);
  assert.doesNotMatch(list, /entityName/);
  assert.match(content, /interfaceLanguage: localized\('Jezik sučelja', 'Lingua dell’interfaccia', 'Interface language'\)/);
  assert.match(content, /shown exactly as the office published it/);
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

test('the office surfaces carry the text actions and the signed answer, and the review queue is gone', async () => {
  await assert.rejects(exists(join('review', 'index.astro')));
  await assert.rejects(access(new URL('src/scripts/pilot/vrsar/review.ts', webRoot)));

  const [caseScript, casePage, officeScript, staffScript, shellScript, loginPage, shellComponent] = await Promise.all([
    readFile(new URL('src/scripts/pilot/vrsar/case-detail.ts', webRoot), 'utf8'),
    readFile(new URL('src/pages/pilot/vrsar/cases/[caseId].astro', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/office-actions.ts', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/staff.ts', webRoot), 'utf8'),
    readFile(new URL('src/scripts/pilot/vrsar/shell.ts', webRoot), 'utf8'),
    readFile(new URL('src/pages/pilot/vrsar/login.astro', webRoot), 'utf8'),
    readFile(new URL('src/components/pilot/vrsar/VrsarPilotShell.astro', webRoot), 'utf8'),
  ]);

  // Nothing routes to a reviewer any more: no role, no nav entry, no demo tap.
  for (const source of [caseScript, officeScript, staffScript, shellScript, loginPage, shellComponent]) {
    assert.doesNotMatch(source, /reviewer/i);
    assert.doesNotMatch(source, /\/pilot\/vrsar\/review/);
  }
  assert.match(caseScript, /const STAFF_ROLES: readonly PilotRole\[\] = \['official'\]/);

  // The case view carries the four text commands from the transition table.
  assert.match(casePage, /data-public-text-section/);
  assert.match(caseScript, /holdCase\(record!\.id, \{/);
  assert.match(caseScript, /releaseCase\(record!\.id, \{ redactedText: text \}\)/);
  assert.match(caseScript, /labelCase\(record!\.id, \{ label: 'form-letter', action: labelled \? 'clear' : 'set' \}\)/);
  for (const reason of ['personal-data', 'abuse', 'off-topic', 'other']) {
    assert.ok(caseScript.includes(`'${reason}'`), reason);
  }
  // Closing moved to the office, and still only where the table allows it.
  assert.match(caseScript, /closeSection\.hidden = role !== 'official'/);
  assert.match(caseScript, /current\.status === 'open' \|\| current\.status === 'assigned'/);

  // The answer is signed and publishes at once; no summary is proposed. The
  // forms moved off the worklist panel into the case workspace.
  assert.match(officeScript, /signedBy,/);
  assert.doesNotMatch(officeScript, /publicSummary/);
  assert.doesNotMatch(officeScript, /expectedVersion: record\.version,\n\s*commitment/);
  assert.match(officeScript, /pilotCopy\.staff\.publishesNow\[lang\]/);
  assert.match(officeScript, /reopenCase\(record\.id/);
});

test('pilot copy has HR default plus Italian and English and separates publication from completion', async () => {
  const source = await readFile(new URL('src/content/pilot/vrsar.ts', webRoot), 'utf8');
  assert.match(source, /PILOT_LANGS = \['hr', 'it', 'en'\]/);
  assert.match(source, /Općina Vrsar-Orsera/);
  assert.match(source, /Neslužbeno testno okruženje/);
  assert.match(source, /Ambiente di test non ufficiale/);
  assert.match(source, /Unofficial test environment/);
  assert.match(source, /Objavljena obveza nije dokaz izvršenog popravka/);
  assert.match(source, /disputed: localized/);
  assert.match(source, /resolved: localized/);
  // There is no reviewer, so no string on any pilot surface may name one.
  assert.doesNotMatch(source, /neovisn/i);
  assert.doesNotMatch(source, /independent/i);
  assert.doesNotMatch(source, /reviewer/i);
});

test('workflow statuses and backend errors have HR, IT, and EN text', () => {
  for (const status of [
    'open',
    'received',
    'assigned',
    'answered',
    'resolved',
    'disputed',
    'closed',
  ]) {
    for (const lang of ['hr', 'it', 'en']) assert.ok(statusLabels[status]?.[lang], `${status}:${lang}`);
  }
  for (const action of [
    'report-filed',
    'record-created',
    'text-held',
    'text-released',
    'label-set',
    'label-cleared',
    'office-assigned',
    'record-assigned',
    'commitment-published',
    'completion-reported',
    'completion-disputed',
    'case-reopened',
    'case-resolved-standing',
    'attachment-added',
    'case-closed',
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
    'dispute_limit',
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
    'text-held',
    'text-released',
    'office-assigned',
    'commitment-published',
    'completion-reported',
    'completion-disputed',
    'case-reopened',
    'case-resolved-standing',
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
    action: 'commitment-published',
    actorRole: 'official',
    createdAt: '2026-09-05T09:00:00.000Z',
  };
  const completion = {
    stage: 'receipt',
    action: 'case-resolved-standing',
    actorRole: 'system',
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

test('anonymous web filing proxy requires origin and idempotency without a session', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      case: {
        caseNumber: 'VRS-482113',
        reopenKey: 'private-reopen-key',
        state: 'received',
      },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  const options = { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl };
  const accepted = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    idempotencyKey: key,
    body: { text: 'Ulična rasvjeta ne radi.', location: 'Vrsar' },
  }), options);
  assert.equal(accepted.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://trace.internal/api/trace/public/cases');
  assert.equal(calls[0].init.headers.get('authorization'), null);
  assert.equal(calls[0].init.headers.get('idempotency-key'), key);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    text: 'Ulična rasvjeta ne radi.',
    location: 'Vrsar',
  });

  const missingOrigin = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    requestOrigin: null,
    idempotencyKey: key,
    body: { text: 'Prijava' },
  }), options);
  assert.equal(missingOrigin.status, 403);

  const extraField = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    idempotencyKey: key,
    body: { text: 'Prijava', channel: 'web' },
  }), options);
  assert.equal(extraField.status, 400);

  const missingKey = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    body: { text: 'Prijava' },
  }), options);
  assert.equal(missingKey.status, 400);
  assert.equal(calls.length, 1);
});
test('erasure and notice proxies are session-free and reject extra fields', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ case: { caseNumber: 'VRS-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const options = { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl };

  const erased = await handlePilotProxy(
    proxyContext('cases/VRS-1/erase-text', {
      method: 'POST',
      idempotencyKey: key,
      body: { reopenKey: 'private-reopen-key' },
    }),
    options,
  );
  assert.equal(erased.status, 200);

  const noticed = await handlePilotProxy(
    proxyContext('public/cases/VRS-1/notice', {
      method: 'POST',
      idempotencyKey: key,
      body: {
        followerKey: 'private-follower-key',
        reason: 'personal-data',
        note: 'Contains a phone number.',
      },
    }),
    options,
  );
  assert.equal(noticed.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://trace.internal/api/trace/cases/VRS-1/erase-text');
  assert.deepEqual(JSON.parse(calls[0].init.body), { reopenKey: 'private-reopen-key' });
  assert.equal(calls[1].url, 'https://trace.internal/api/trace/public/cases/VRS-1/notice');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    followerKey: 'private-follower-key',
    reason: 'personal-data',
    note: 'Contains a phone number.',
  });
  for (const call of calls) {
    assert.equal(call.init.headers.get('authorization'), null);
    assert.equal(call.init.headers.get('idempotency-key'), key);
  }

  const extraEraseField = await handlePilotProxy(
    proxyContext('cases/VRS-1/erase-text', {
      method: 'POST',
      idempotencyKey: key,
      body: { reopenKey: 'private-reopen-key', reason: 'filer' },
    }),
    options,
  );
  assert.equal(extraEraseField.status, 400);

  const extraNoticeField = await handlePilotProxy(
    proxyContext('public/cases/VRS-1/notice', {
      method: 'POST',
      idempotencyKey: key,
      body: {
        followerKey: 'private-follower-key',
        reason: 'personal-data',
        note: 'Contains a phone number.',
        channel: 'web',
      },
    }),
    options,
  );
  assert.equal(extraNoticeField.status, 400);
  assert.equal(calls.length, 2);
});


test('the filing proxy forwards a full-size photo and refuses an unknown photo field', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      case: { caseNumber: 'VRS-118820', reopenKey: 'private-reopen-key', state: 'received' },
    }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const options = { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl };

  // The backend takes 2 MiB decoded, which is about 2.8 MB of base64 on the wire.
  const base64 = 'A'.repeat(Math.ceil((2 * 1024 * 1024) / 3) * 4);
  const accepted = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    idempotencyKey: key,
    body: {
      text: 'Rupa na kolniku.',
      location: '45.15000,13.60000',
      photo: { contentType: 'image/jpeg', base64 },
    },
  }), options);
  assert.equal(accepted.status, 201);
  assert.equal(calls.length, 1);
  const forwarded = JSON.parse(calls[0].init.body);
  assert.equal(forwarded.photo.contentType, 'image/jpeg');
  assert.equal(forwarded.photo.base64.length, base64.length);

  const unknownPhotoField = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    idempotencyKey: key,
    body: { text: 'Prijava', photo: { contentType: 'image/jpeg', base64: 'AAAA', filename: 'a.jpg' } },
  }), options);
  assert.equal(unknownPhotoField.status, 400);

  const photoNotAnObject = await handlePilotProxy(proxyContext('public/cases', {
    method: 'POST',
    idempotencyKey: key,
    body: { text: 'Prijava', photo: 'AAAA' },
  }), options);
  assert.equal(photoNotAnObject.status, 400);
  assert.equal(calls.length, 1);
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

test('demo sign-in exchanges a role for a session and never takes an address or a passcode from the browser', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      sessionToken: 'demo-session-token',
      citizen: { id: 'actor-official', email: 'official@vrsar.example.test' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const options = {
    publicRelease: true,
    testInstance: true,
    backendBase: 'https://trace.internal',
    demoPasscode: 'shared-demo-passcode',
    fetchImpl,
  };

  const official = await handlePilotProxy(proxyContext('identity/demo-login', {
    method: 'POST',
    body: { role: 'official' },
  }), options);
  assert.equal(official.status, 200);
  assert.deepEqual(await official.json(), { ok: true });
  assert.equal(calls[0].url, 'https://trace.internal/api/v1/identity/exchange');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: 'official@vrsar.example.test',
    passcode: 'shared-demo-passcode',
  });
  assert.equal(calls[0].init.headers.get('authorization'), null);
  assert.equal(calls[0].init.headers.get('idempotency-key'), null);
  assert.match(official.headers.get('set-cookie') ?? '', /polis_pilot_session=demo-session-token/);
  assert.match(official.headers.get('set-cookie') ?? '', /HttpOnly/);

  const renamed = await handlePilotProxy(proxyContext('identity/demo-login', {
    method: 'POST',
    body: { role: 'official' },
  }), {
    ...options,
    demoOfficialEmail: 'sluzbenik@vrsar.example.test',
  });
  assert.equal(renamed.status, 200);
  assert.equal(JSON.parse(calls[1].init.body).email, 'sluzbenik@vrsar.example.test');

  for (const body of [
    { role: 'resident' },
    { role: 'reviewer' },
    { role: 'admin' },
    { role: '' },
    {},
    { role: ['official'] },
  ]) {
    const rejected = await handlePilotProxy(proxyContext('identity/demo-login', {
      method: 'POST',
      body,
    }), options);
    assert.equal(rejected.status, 400, JSON.stringify(body));
  }

  for (const body of [
    { role: 'official', email: 'mayor@vrsar.example.test' },
    { role: 'official', passcode: 'guessed' },
    { email: 'mayor@vrsar.example.test', passcode: 'guessed' },
  ]) {
    const smuggled = await handlePilotProxy(proxyContext('identity/demo-login', {
      method: 'POST',
      body,
    }), options);
    assert.equal(smuggled.status, 400, JSON.stringify(body));
  }

  const wrongMethod = await handlePilotProxy(proxyContext('identity/demo-login'), options);
  assert.equal(wrongMethod.status, 404);
  assert.equal(calls.length, 2);
});

test('demo sign-in does not exist without the test instance flag or without the passcode', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return new Response(JSON.stringify({ sessionToken: 'demo-session-token' }), { status: 200 });
  };

  const withoutPasscode = await handlePilotProxy(proxyContext('identity/demo-login', {
    method: 'POST',
    body: { role: 'official' },
  }), {
    publicRelease: true,
    testInstance: true,
    backendBase: 'https://trace.internal',
    demoPasscode: '',
    fetchImpl,
  });
  assert.equal(withoutPasscode.status, 404);
  assert.equal((await withoutPasscode.json()).error, 'not_found');

  const offTheTestInstance = await handlePilotProxy(proxyContext('identity/demo-login', {
    method: 'POST',
    body: { role: 'official' },
  }), {
    publicRelease: false,
    testInstance: false,
    backendBase: 'https://trace.internal',
    demoPasscode: 'shared-demo-passcode',
    fetchImpl,
  });
  assert.equal(offTheTestInstance.status, 404);
  assert.equal(called, 0);
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

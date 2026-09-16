// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { startService } from '@polis/service-runtime';

import { DomainError } from './domain.js';
import type {
  AiProposal,
  AttachmentDownload,
  CaseMessage,
  CaseShell,
  CommandContext,
  FilerCaseView,
  PilotConfig,
  PrivateRecord,
  PublicRecord,
  TraceConfig,
  TraceStore,
} from './types.js';
import { traceRoutes } from './routes.js';

const pilot: PilotConfig = {
  id: 'vrsar-orsera',
  testEnvironment: true,
  publicTextMode: 'open',
  publicTextRetentionDays: 730,
  municipality: { id: 'vrsar-orsera', name: { hr: 'Vrsar', it: 'Orsera', en: 'Vrsar' } },
  category: { id: 'public-lighting', name: { hr: 'Rasvjeta', it: 'Luci', en: 'Lighting' } },
  office: {
    id: 'communal-system',
    name: { hr: 'Komunalni', it: 'Comunale', en: 'Communal' },
    routingStatus: 'inferred-test-only',
  },
  sources: [
    {
      id: 'source',
      title: 'Source',
      url: 'https://example.test/',
      retrievedAt: '2026-09-05',
      supports: ['Fact'],
    },
  ],
};

function config(intakeOpen = true): TraceConfig {
  return {
    internalApiToken: 'trace-internal-test-token',
    databaseUrl: 'postgres://unused.test/trace',
    intakeOpen,
    officialIds: new Set(['trace-official-test']),
    gatewayIds: new Set(['sms-gateway']),
    pilot,
  };
}

function privateRecord(): PrivateRecord {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    municipalityId: 'vrsar-orsera',
    category: 'public-lighting',
    status: 'open',
    version: 0,
    subject: 'Private subject',
    narrative: 'Private narrative',
    location: 'Private location',
    contactEmail: null,
    office: 'communal-system',
    signedBy: null,
    commitment: null,
    dueDate: null,
    evidenceNote: null,
    evidenceUrls: [],
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    events: [],
    attachments: [],
    caseNumber: 'VRS-1842',
    origin: 'web',
    filerKind: 'account',
    closedReason: null,
    closedPublicReason: null,
    followerCount: 0,
    alsoAffectedCount: 0,
    notFixedCount: 0,
    disputeCount: 0,
    aiProposals: [],
  };
}
function caseShell(): CaseShell {
  return {
    caseNumber: 'VRS-1842',
    municipalityId: 'vrsar-orsera',
    area: 'Square',
    category: 'public-lighting',
    track: 'standard',
    state: 'received',
    text: 'Lamp is dark.',
    location: 'Square',
    textStatus: 'public',
    holdReason: null,
    removedReason: null,
    textSha256: 'd'.repeat(64),
    labels: [],
    closedPublicReason: null,
    filedAt: '2026-09-12T10:00:00.000Z',
    clockDueAt: null,
    followerCount: 0,
    alsoAffectedCount: 0,
    notFixedCount: 0,
    disputeCount: 0,
    noticeCount: 0,
    shellHash: 'a'.repeat(64),
    updatedAt: '2026-09-12T10:00:00.000Z',
    testEnvironment: true,
  };
}
function publicRecord(): PublicRecord {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    municipalityId: 'vrsar-orsera',
    category: 'public-lighting',
    office: 'communal-system',
    status: 'answered',
    commitment: 'Replace the lamp',
    dueDate: '2026-10-01',
    signedBy: { name: 'Ana Anić', title: 'Head of public works' },
    evidenceNote: null,
    evidenceUrls: [],
    publishedAt: '2026-09-12T10:00:00.000Z',
    resolvedAt: null,
    disputes: [],
    events: [],
    receiptHash: 'e'.repeat(64),
    testEnvironment: true,
  };
}

function caseMessage(): CaseMessage {
  return {
    id: '30000000-0000-4000-8000-000000000001',
    recordId: '20000000-0000-4000-8000-000000000001',
    direction: 'inbound',
    kind: 'append',
    channel: 'sms',
    source: 'typed',
    body: 'Lamp is dark.',
    bodySha256: 'b'.repeat(64),
    noticeReason: null,
    authorKind: 'filer',
    authorActorId: null,
    inReplyTo: null,
    deliveryState: 'not-applicable',
    deliveryFailureCode: null,
    deliveredAt: null,
    createdAt: '2026-09-12T10:00:00.000Z',
  };
}

function aiProposal(): AiProposal {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    recordId: '20000000-0000-4000-8000-000000000001',
    kind: 'category',
    proposedValue: { category: 'public-lighting' },
    confidence: 0.9,
    modelId: 'ai-gateway/case-intake-v1',
    modelVersion: '0.1',
    promptSha256: 'c'.repeat(64),
    aiTraceId: null,
    aiOutputId: null,
    status: 'proposed',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: '2026-09-12T10:00:00.000Z',
  };
}

function fakeStore(overrides: Partial<TraceStore> = {}): TraceStore {
  const record = privateRecord();
  const shell = caseShell();
  const message = caseMessage();
  const proposal = aiProposal();
  const ok = async () => ({ status: 200, body: { record } });
  const filerCase: FilerCaseView = {
    caseNumber: shell.caseNumber,
    state: shell.state,
    category: shell.category,
    office: 'communal-system',
    location: 'Square',
    narrative: 'Lamp is dark.',
    clockDueAt: null,
    createdAt: shell.filedAt,
    updatedAt: shell.updatedAt,
    attachments: [],
    messages: [message],
    events: [],
    shell,
  };
  return {
    check: async () => undefined,
    listPrivate: async () => [record],
    getPrivate: async () => record,
    create: async () => ({ status: 201, body: { record } }),
    assign: ok,
    commitment: ok,
    resolution: ok,
    reopen: ok,
    hold: ok,
    release: ok,
    label: ok,
    addAttachment: async () => ({ status: 201, body: { attachment: { id: record.id } } }),
    downloadAttachment: async (): Promise<AttachmentDownload> => ({
      bytes: Uint8Array.from([1, 2, 3]),
      filename: 'evidence.pdf',
      contentType: 'application/pdf',
    }),
    listPublic: async (): Promise<PublicRecord[]> => [],
    getPublic: async () => null,
    createChannelCase: async () => ({
      case: {
        recordId: record.id,
        caseNumber: shell.caseNumber,
        reopenKey: 'reopen-secret-12345678',
        state: shell.state,
      },
      shell,
    }),
    appendChannelMessage: async () => ({ message }),
    listOutbox: async () => ({ messages: [message] }),
    markOutboxDelivery: async () => ({ message }),
    readFilerCase: async () => ({ case: filerCase }),
    appendFilerMessage: async () => ({ message }),
    dispute: async () => ({ case: shell, record: publicRecord() }),
    eraseText: async () => ({ case: shell }),
    listMessages: async () => ({ messages: [message] }),
    postOfficialMessage: async () => ({ message, record }),
    proposeAi: async () => ({ proposal }),
    decideAi: async () => ({ proposal, record }),
    closeCase: async () => ({ record, shell }),
    listPublicShells: async () => ({ cases: [shell] }),
    getPublicCase: async () => ({ case: shell, record: null }),
    recordAttention: async () => ({
      counts: { followerCount: 1, alsoAffectedCount: 0, notFixedCount: 0 },
    }),
    recordNotice: async () => ({ case: shell }),
    close: async () => undefined,
    ...overrides,
  };
}

async function withServer(
  store: TraceStore,
  traceConfig: TraceConfig,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = traceConfig.internalApiToken;
  const server = startService('trace-service-test', 0, traceRoutes(store, traceConfig));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
}

function internalHeaders(actor?: string, key?: string): Record<string, string> {
  return {
    'x-polis-internal-token': 'trace-internal-test-token',
    ...(actor ? { 'x-polis-citizen': actor, 'x-polis-identity-level': 'verified' } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
    'content-type': 'application/json',
  };
}
const VALID_IDEMPOTENCY_KEY = '10000000-0000-4000-8000-000000000001';
const RECORD_ID = '20000000-0000-4000-8000-000000000001';
const MESSAGE_ID = '30000000-0000-4000-8000-000000000001';
const PROPOSAL_ID = '40000000-0000-4000-8000-000000000001';

function gatewayHeaders(gateway: string | undefined, citizen?: string): Record<string, string> {
  return {
    ...internalHeaders(citizen, VALID_IDEMPOTENCY_KEY),
    ...(gateway === undefined ? {} : { 'x-polis-trace-gateway': gateway }),
  };
}

test('route table exposes every exact internal trace path', () => {
  const paths = traceRoutes(fakeStore(), config()).map((route) => `${route.method} ${route.path}`);
  for (const expected of [
    'GET /healthz',
    'GET /readyz',
    'GET /internal/trace/config',
    'GET /internal/trace/session',
    'GET /internal/trace/records',
    'POST /internal/trace/records',
    'GET /internal/trace/records/:id',
    'POST /internal/trace/records/:id/assign',
    'POST /internal/trace/records/:id/commitment',
    'POST /internal/trace/records/:id/resolution',
    'POST /internal/trace/records/:id/reopen',
    'POST /internal/trace/records/:id/hold',
    'POST /internal/trace/records/:id/release',
    'POST /internal/trace/records/:id/label',
    'POST /internal/trace/records/:id/attachments',
    'GET /internal/trace/records/:id/attachments/:attachmentId',
    'GET /internal/trace/public/records',
    'GET /internal/trace/public/records/:id',
    'POST /internal/trace/channel/cases',
    'POST /internal/trace/channel/cases/:caseNumber/messages',
    'GET /internal/trace/channel/outbox',
    'POST /internal/trace/channel/outbox/:messageId/delivery',
    'POST /internal/trace/cases/:caseNumber/private',
    'POST /internal/trace/cases/:caseNumber/dispute',
    'POST /internal/trace/cases/:caseNumber/erase-text',
    'POST /internal/trace/cases/:caseNumber/messages',
    'GET /internal/trace/records/:id/messages',
    'POST /internal/trace/records/:id/messages',
    'POST /internal/trace/records/:id/ai-proposals',
    'POST /internal/trace/records/:id/ai-proposals/:proposalId/decision',
    'POST /internal/trace/records/:id/close',
    'GET /internal/trace/public/cases',
    'GET /internal/trace/public/cases/:caseNumber',
    'POST /internal/trace/public/cases/:caseNumber/attention',
    'POST /internal/trace/public/cases/:caseNumber/notice',
  ]) {
    assert.ok(paths.includes(expected), expected);
  }
  const channelCreate = traceRoutes(fakeStore(), config()).find(
    (route) => route.method === 'POST' && route.path === '/internal/trace/channel/cases',
  );
  assert.equal(channelCreate?.maxBodyBytes, 2_920_000);
});

test('internal token and trusted actor are required; mapped role ignores browser identity level', async () => {
  await withServer(fakeStore(), config(), async (base) => {
    const missingToken = await fetch(`${base}/internal/trace/config`);
    assert.equal(missingToken.status, 401);
    const missingActor = await fetch(`${base}/internal/trace/session`, {
      headers: internalHeaders(),
    });
    assert.equal(missingActor.status, 401);
    const session = await fetch(`${base}/internal/trace/session`, {
      headers: { ...internalHeaders('trace-official-test'), 'x-polis-identity-level': 'resident' },
    });
    assert.equal(session.status, 200);
    assert.deepEqual(await session.json(), {
      actorId: 'trace-official-test',
      email: null,
      role: 'official',
      municipalityId: 'vrsar-orsera',
    });
    assert.equal(session.headers.get('cache-control'), 'no-store');
  });
});

test('closed intake, authority fields, missing idempotency, and list overflow return safe errors', async () => {
  let creates = 0;
  const store = fakeStore({
    create: async (_ctx: CommandContext) => {
      creates += 1;
      throw new DomainError(503, 'intake_closed', 'New trace reports are temporarily closed.');
    },
  });
  await withServer(store, config(false), async (base) => {
    const request = async (body: unknown, key?: string) =>
      fetch(`${base}/internal/trace/records`, {
        method: 'POST',
        headers: internalHeaders('trace-resident-test', key),
        body: JSON.stringify(body),
      });
    const authority = await request(
      { subject: 's', narrative: 'n', location: 'l', municipalityId: 'forged' },
      '10000000-0000-4000-8000-000000000001',
    );
    assert.equal(authority.status, 400);
    assert.equal(
      ((await authority.json()) as { error: string }).error,
      'authority_field_forbidden',
    );
    const missingKey = await request({ subject: 's', narrative: 'n', location: 'l' });
    assert.equal(missingKey.status, 400);
    const closed = await request(
      { subject: 's', narrative: 'n', location: 'l' },
      '10000000-0000-4000-8000-000000000002',
    );
    assert.equal(closed.status, 503);
    assert.equal(((await closed.json()) as { error: string }).error, 'intake_closed');
    const overflow = await fetch(`${base}/internal/trace/records?limit=101`, {
      headers: internalHeaders('trace-resident-test'),
    });
    assert.equal(overflow.status, 400);
    assert.equal(creates, 1);
  });
});

test('disguised upload content is rejected before repository storage', async () => {
  let uploads = 0;
  const store = fakeStore({
    addAttachment: async () => {
      uploads += 1;
      return { status: 201, body: {} };
    },
  });
  await withServer(store, config(), async (base) => {
    const id = '20000000-0000-4000-8000-000000000001';
    const response = await fetch(`${base}/internal/trace/records/${id}/attachments`, {
      method: 'POST',
      headers: internalHeaders('trace-resident-test', '10000000-0000-4000-8000-000000000003'),
      body: JSON.stringify({
        expectedVersion: 0,
        filename: 'page.txt',
        contentType: 'text/plain',
        base64: Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'attachment_content_mismatch',
      message: 'Attachment bytes do not match the declared content type.',
    });
    assert.equal(uploads, 0);
  });
});

test('integrity failures return a safe 503 instead of a normal record', async () => {
  const store = fakeStore({
    getPrivate: async () => {
      throw new DomainError(503, 'trace_integrity_failed', 'Trace integrity verification failed.');
    },
  });
  await withServer(store, config(), async (base) => {
    const id = '20000000-0000-4000-8000-000000000001';
    const response = await fetch(`${base}/internal/trace/records/${id}`, {
      headers: internalHeaders('trace-resident-test'),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'trace_integrity_failed',
      message: 'Trace integrity verification failed.',
    });
  });
});

test('private download is attachment-only, no-store, and nosniff; unpublished public record is 404', async () => {
  await withServer(fakeStore(), config(), async (base) => {
    const id = '20000000-0000-4000-8000-000000000001';
    const attachment = await fetch(`${base}/internal/trace/records/${id}/attachments/${id}`, {
      headers: internalHeaders('trace-resident-test'),
    });
    assert.equal(attachment.status, 200);
    assert.equal(attachment.headers.get('cache-control'), 'private, no-store');
    assert.equal(attachment.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      attachment.headers.get('content-disposition'),
      `attachment; filename="evidence.pdf"; filename*=UTF-8''evidence.pdf`,
    );
    assert.deepEqual(new Uint8Array(await attachment.arrayBuffer()), Uint8Array.from([1, 2, 3]));
    const unpublished = await fetch(`${base}/internal/trace/public/records/${id}`, {
      headers: internalHeaders(),
    });
    assert.equal(unpublished.status, 404);
    assert.equal(
      ((await unpublished.json()) as { error: string }).error,
      'public_record_not_found',
    );
  });
});

test('private download uses an ASCII fallback plus RFC 5987 for Unicode filenames', async () => {
  const store = fakeStore({
    downloadAttachment: async () => ({
      bytes: Uint8Array.from([1]),
      filename: 'račun.pdf',
      contentType: 'application/pdf',
    }),
  });
  await withServer(store, config(), async (base) => {
    const id = '20000000-0000-4000-8000-000000000001';
    const response = await fetch(`${base}/internal/trace/records/${id}/attachments/${id}`, {
      headers: internalHeaders('trace-resident-test'),
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-disposition'),
      `attachment; filename="ra_un.pdf"; filename*=UTF-8''ra%C4%8Dun.pdf`,
    );
  });
});

test('health and readiness both fail closed when the database is unavailable', async () => {
  const store = fakeStore({
    check: async () => {
      throw new Error('private database detail');
    },
  });
  await withServer(store, config(), async (base) => {
    for (const path of ['/healthz', '/readyz']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes('private database detail'), false);
      assert.equal((JSON.parse(text) as { dependency: string }).dependency, 'database');
    }
  });
});

test('gateway routes reject missing, unknown, and mixed principals', async () => {
  await withServer(fakeStore(), config(), async (base) => {
    const url = `${base}/internal/trace/channel/cases`;
    const body = JSON.stringify({
      channel: 'sms',
      text: 'Lamp is dark.',
      source: 'typed',
      occurredAt: '2026-09-12T10:00:00.000Z',
    });
    for (const headers of [
      gatewayHeaders(undefined),
      gatewayHeaders('unknown-gateway'),
      gatewayHeaders('sms-gateway', 'trace-resident-test'),
    ]) {
      const response = await fetch(url, { method: 'POST', headers, body });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: 'authentication_required',
        message: 'Authentication is required.',
      });
    }
    const accepted = await fetch(url, {
      method: 'POST',
      headers: gatewayHeaders('sms-gateway'),
      body,
    });
    assert.equal(accepted.status, 201);
  });
});

test('reopen reads need no actor and conceal wrong keys like unknown case numbers', async () => {
  const store = fakeStore({
    readFilerCase: async (caseNumber, reopenKey) => {
      if (caseNumber !== 'VRS-1842' || reopenKey !== 'correct-secret-12345678') {
        throw new DomainError(404, 'case_not_found', 'Case not found.');
      }
      return fakeStore().readFilerCase(caseNumber, reopenKey);
    },
  });
  await withServer(store, config(), async (base) => {
    const readCase = (caseNumber: string, reopenKey: string) =>
      fetch(`${base}/internal/trace/cases/${caseNumber}/private`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({ reopenKey }),
      });
    const accepted = await readCase('VRS-1842', 'correct-secret-12345678');
    assert.equal(accepted.status, 200);
    const wrongKey = await readCase('VRS-1842', 'wrong-secret-123456789');
    const unknownCase = await readCase('VRS-9999', 'correct-secret-12345678');
    assert.equal(wrongKey.status, 404);
    assert.equal(unknownCase.status, 404);
    assert.equal(await wrongKey.text(), await unknownCase.text());
  });
});

test('only channel creation responses expose a reopen key', async () => {
  await withServer(fakeStore(), config(), async (base) => {
    const create = await fetch(`${base}/internal/trace/channel/cases`, {
      method: 'POST',
      headers: gatewayHeaders('sms-gateway'),
      body: JSON.stringify({
        channel: 'sms',
        text: 'Lamp is dark.',
        source: 'typed',
        occurredAt: '2026-09-12T10:00:00.000Z',
      }),
    });
    assert.equal((await create.text()).includes('reopenKey'), true);

    const requests: Array<() => Promise<Response>> = [
      () =>
        fetch(`${base}/internal/trace/channel/cases/VRS-1842/messages`, {
          method: 'POST',
          headers: gatewayHeaders('sms-gateway'),
          body: JSON.stringify({
            reopenKey: 'reopen-secret-12345678',
            channel: 'sms',
            kind: 'append',
            text: 'More detail.',
            source: 'typed',
            occurredAt: '2026-09-12T10:01:00.000Z',
          }),
        }),
      () =>
        fetch(`${base}/internal/trace/channel/outbox`, {
          headers: gatewayHeaders('sms-gateway'),
        }),
      () =>
        fetch(`${base}/internal/trace/channel/outbox/${MESSAGE_ID}/delivery`, {
          method: 'POST',
          headers: gatewayHeaders('sms-gateway'),
          body: JSON.stringify({ state: 'delivered' }),
        }),
      () =>
        fetch(`${base}/internal/trace/cases/VRS-1842/private`, {
          method: 'POST',
          headers: internalHeaders(),
          body: JSON.stringify({ reopenKey: 'reopen-secret-12345678' }),
        }),
      () =>
        fetch(`${base}/internal/trace/cases/VRS-1842/messages`, {
          method: 'POST',
          headers: internalHeaders(undefined, VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({ reopenKey: 'reopen-secret-12345678', body: 'More detail.' }),
        }),
      () =>
        fetch(`${base}/internal/trace/records/${RECORD_ID}/messages`, {
          headers: internalHeaders('trace-official-test'),
        }),
      () =>
        fetch(`${base}/internal/trace/records/${RECORD_ID}/messages`, {
          method: 'POST',
          headers: internalHeaders('trace-official-test', VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({
            expectedVersion: 0,
            kind: 'answer',
            body: 'Crew notified.',
          }),
        }),
      () =>
        fetch(`${base}/internal/trace/records/${RECORD_ID}/ai-proposals`, {
          method: 'POST',
          headers: internalHeaders(undefined, VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({
            kind: 'category',
            proposedValue: { category: 'public-lighting' },
            confidence: 0.9,
            modelId: 'ai-gateway/case-intake-v1',
            modelVersion: '0.1',
            promptSha256: 'c'.repeat(64),
          }),
        }),
      () =>
        fetch(`${base}/internal/trace/records/${RECORD_ID}/ai-proposals/${PROPOSAL_ID}/decision`, {
          method: 'POST',
          headers: internalHeaders('trace-official-test', VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({ expectedVersion: 0, decision: 'accepted' }),
        }),
      () =>
        fetch(`${base}/internal/trace/records/${RECORD_ID}/close`, {
          method: 'POST',
          headers: internalHeaders('trace-official-test', VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({
            expectedVersion: 0,
            reason: 'out-of-scope',
            publicReason: 'Outside this pilot category.',
          }),
        }),
      () => fetch(`${base}/internal/trace/public/cases`, { headers: internalHeaders() }),
      () =>
        fetch(`${base}/internal/trace/public/cases/VRS-1842`, {
          headers: internalHeaders(),
        }),
      () =>
        fetch(`${base}/internal/trace/public/cases/VRS-1842/attention`, {
          method: 'POST',
          headers: internalHeaders(undefined, VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({
            followerKey: 'browser-follower-secret',
            kind: 'follow',
            action: 'add',
          }),
        }),
      () =>
        fetch(`${base}/internal/trace/cases/VRS-1842/erase-text`, {
          method: 'POST',
          headers: internalHeaders(),
          body: JSON.stringify({ reopenKey: 'Abcdefghijklmnop_1234' }),
        }),
      () =>
        fetch(`${base}/internal/trace/public/cases/VRS-1842/notice`, {
          method: 'POST',
          headers: internalHeaders(undefined, VALID_IDEMPOTENCY_KEY),
          body: JSON.stringify({
            followerKey: 'browser-follower-secret',
            reason: 'personal-data',
            note: 'Contains a name.',
          }),
        }),
    ];
    for (const request of requests) {
      const response = await request();
      const responseText = await response.text();
      assert.ok(response.status < 400, `${response.status}: ${responseText}`);
      assert.equal(responseText.includes('reopenKey'), false);
    }
  });
});

test('public cases need no actor; close and AI decisions enforce staff roles', async () => {
  await withServer(fakeStore(), config(), async (base) => {
    const publicCase = await fetch(`${base}/internal/trace/public/cases/VRS-1842`, {
      headers: internalHeaders(),
    });
    assert.equal(publicCase.status, 200);

    const closeBody = JSON.stringify({
      expectedVersion: 0,
      reason: 'out-of-scope',
      publicReason: 'Outside this pilot category.',
    });
    const residentClose = await fetch(`${base}/internal/trace/records/${RECORD_ID}/close`, {
      method: 'POST',
      headers: internalHeaders('trace-resident-test', VALID_IDEMPOTENCY_KEY),
      body: closeBody,
    });
    assert.equal(residentClose.status, 403);
    const officialClose = await fetch(`${base}/internal/trace/records/${RECORD_ID}/close`, {
      method: 'POST',
      headers: internalHeaders('trace-official-test', VALID_IDEMPOTENCY_KEY),
      body: closeBody,
    });
    assert.equal(officialClose.status, 200);

    const decisionUrl = `${base}/internal/trace/records/${RECORD_ID}/ai-proposals/${PROPOSAL_ID}/decision`;
    const decisionBody = JSON.stringify({ expectedVersion: 0, decision: 'accepted' });
    const residentDecision = await fetch(decisionUrl, {
      method: 'POST',
      headers: internalHeaders('trace-resident-test', VALID_IDEMPOTENCY_KEY),
      body: decisionBody,
    });
    assert.equal(residentDecision.status, 403);
    const accepted = await fetch(decisionUrl, {
      method: 'POST',
      headers: internalHeaders('trace-official-test', VALID_IDEMPOTENCY_KEY),
      body: decisionBody,
    });
    assert.equal(accepted.status, 200);
  });
});

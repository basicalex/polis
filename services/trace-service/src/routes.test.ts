import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { startService } from '@polis/service-runtime';

import { DomainError } from './domain.js';
import type {
  AttachmentDownload,
  CommandContext,
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
    reviewerIds: new Set(['trace-reviewer-test']),
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
    publicSummary: null,
    commitment: null,
    dueDate: null,
    evidenceNote: null,
    evidenceUrls: [],
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    events: [],
    attachments: [],
  };
}

function fakeStore(overrides: Partial<TraceStore> = {}): TraceStore {
  const record = privateRecord();
  const ok = async () => ({ status: 200, body: { record } });
  return {
    check: async () => undefined,
    listPrivate: async () => [record],
    getPrivate: async () => record,
    create: async () => ({ status: 201, body: { record } }),
    assign: ok,
    commitment: ok,
    review: ok,
    resolution: ok,
    resolutionReview: ok,
    addAttachment: async () => ({ status: 201, body: { attachment: { id: record.id } } }),
    downloadAttachment: async (): Promise<AttachmentDownload> => ({
      bytes: Uint8Array.from([1, 2, 3]),
      filename: 'evidence.pdf',
      contentType: 'application/pdf',
    }),
    listPublic: async (): Promise<PublicRecord[]> => [],
    getPublic: async () => null,
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
    'POST /internal/trace/records/:id/review',
    'POST /internal/trace/records/:id/resolution',
    'POST /internal/trace/records/:id/resolution-review',
    'POST /internal/trace/records/:id/attachments',
    'GET /internal/trace/records/:id/attachments/:attachmentId',
    'GET /internal/trace/public/records',
    'GET /internal/trace/public/records/:id',
  ]) {
    assert.ok(paths.includes(expected), expected);
  }
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

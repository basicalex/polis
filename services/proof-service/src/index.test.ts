import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { proofRoutes } from './index.js';

test('proof-service exposes §9.12 + §9.18 proof + verify routes', () => {
  const paths = proofRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/proofs/manifests',
    'POST /api/v1/verify/file',
    'POST /api/v1/verify/hash',
    'POST /api/v1/verify/manifest',
    'GET /api/v1/proofs/:id',
    'GET /api/v1/proofs/:id/status',
    'GET /api/v1/proofs/:id/audit',
    'GET /api/v1/issuers/:id',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

const proofRow = (proofVisibility = 'public') => ({
  id: 'proof-1',
  documentClass: 'public-government-record',
  documentTypeId: null,
  issuerId: 'issuer-1',
  issuerName: 'Issuer',
  originalFileHash: 'original-hash',
  canonicalPdfHash: null,
  ocrTextHash: null,
  metadataHash: null,
  manifestHash: 'manifest-hash',
  originalFilename: 'charter.pdf',
  originalMime: 'application/pdf',
  originalBytes: '12',
  algorithm: 'sha256',
  registryStatus: 'active',
  contentVisibility: 'restricted',
  proofVisibility,
  manifestJson: null,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
  createdByService: 'document-signing-service',
  auditCorrelationId: null,
});

function queuedDb(selectRows: unknown[][], insertedValues?: unknown[]) {
  return {
    select: () => {
      const rows = selectRows.shift() ?? [];
      const builder = {
        from() {
          return this;
        },
        where() {
          return this;
        },
        orderBy() {
          return this;
        },
        limit: async () => rows,
        then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return builder;
    },
    insert: () => ({
      values(value: unknown) {
        insertedValues?.push(value);
        return {
          returning: async () => [value],
        };
      },
    }),
  };
}

test('non-public proofs are not_found on every public proof route', async () => {
  const restricted = proofRow('restricted');
  const cases: Array<[string, unknown, Record<string, string>]> = [
    ['/api/v1/verify/file', { contentBase64: Buffer.from('x').toString('base64') }, {}],
    ['/api/v1/verify/hash', { hash: restricted.originalFileHash }, {}],
    ['/api/v1/verify/manifest', { manifestHash: restricted.manifestHash }, {}],
    ['/api/v1/proofs/:id', {}, { id: restricted.id }],
    ['/api/v1/proofs/:id/status', {}, { id: restricted.id }],
    ['/api/v1/proofs/:id/audit', {}, { id: restricted.id }],
  ];
  for (const [path, body, params] of cases) {
    const route = proofRoutes(queuedDb([[restricted]]) as never).find((item) => item.path === path)!;
    const output = (await route.handler({} as never, body, params)) as {
      status: string | number;
      body?: { error?: string };
    };
    if (path.startsWith('/api/v1/proofs/')) {
      assert.equal(output.status, 404, path);
      assert.equal(output.body?.error, 'not_found', path);
    } else {
      assert.equal(output.status, 'not_found', path);
    }
  }
});

test('hash verification reports revoked before valid', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'proof-test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch;
  try {
    const db = queuedDb([
      [proofRow()],
      [],
      [],
      [],
      [{ reason: 'withdrawn', createdAt: new Date('2026-07-30T01:00:00.000Z') }],
    ]);
    const route = proofRoutes(db as never).find((item) => item.path === '/api/v1/verify/hash')!;
    const output = (await route.handler(
      {} as never,
      { hash: 'original-hash' },
      {},
    )) as { status: string; manifest: { registryStatus: string } };
    assert.equal(output.status, 'revoked');
    assert.equal(output.manifest.registryStatus, 'revoked');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('manifest_json is present in the only manifest insert', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'proof-test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url);
    if (path.endsWith('/internal/signatures')) {
      return new Response(JSON.stringify({ id: 'signature-1' }), { status: 201 });
    }
    if (path.endsWith('/internal/timestamps')) {
      return new Response(JSON.stringify({ id: 'timestamp-1' }), { status: 201 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }) as typeof globalThis.fetch;
  const inserts: unknown[] = [];
  try {
    const route = proofRoutes(queuedDb([], inserts) as never).find(
      (item) => item.path === '/internal/proofs/manifests',
    )!;
    const output = (await route.handler(
      {} as never,
      {
        originalFileHash: 'original-hash',
        manifestHash: 'manifest-hash',
        documentClass: 'signed-charter',
        issuerId: 'issuer-1',
        contentVisibility: 'restricted',
        proofVisibility: 'public',
        createdByService: 'document-signing-service',
      },
      {},
    )) as { status: number };
    assert.equal(output.status, 201);
    assert.equal(inserts.length, 1);
    const inserted = inserts[0] as {
      id: string;
      createdByService: string;
      manifestJson: { id: string; proofVisibility: string };
    };
    assert.equal(inserted.manifestJson.id, inserted.id);
    assert.equal(inserted.manifestJson.proofVisibility, 'public');
    assert.equal(inserted.createdByService, 'document-signing-service');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('manifest creation rejects unknown creator services before inserting', async () => {
  const inserts: unknown[] = [];
  const route = proofRoutes(queuedDb([], inserts) as never).find(
    (item) => item.path === '/internal/proofs/manifests',
  )!;
  const output = (await route.handler(
    {} as never,
    {
      originalFileHash: 'original-hash',
      manifestHash: 'manifest-hash',
      documentClass: 'signed-charter',
      issuerId: 'issuer-1',
      createdByService: 'untrusted-service',
    },
    {},
  )) as { status: number; body: { error: string } };
  assert.equal(output.status, 400);
  assert.deepEqual(output.body, { error: 'invalid_created_by_service' });
  assert.equal(inserts.length, 0);
});
test('manifest and hash verification apply child then stored lifecycle precedence', async () => {
  const manifestRoute = proofRoutes(
    queuedDb([
      [proofRow()],
      [],
      [{ reason: 'withdrawn', createdAt: new Date('2026-07-30T01:00:00.000Z') }],
    ]) as never,
  ).find((item) => item.path === '/api/v1/verify/manifest')!;
  const manifestOutput = (await manifestRoute.handler(
    {} as never,
    { manifestHash: 'manifest-hash' },
    {},
  )) as { status: string };
  assert.equal(manifestOutput.status, 'revoked');

  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'proof-test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), { status: 201 })) as typeof globalThis.fetch;
  try {
    const storedExpired = { ...proofRow(), registryStatus: 'expired' };
    const hashRoute = proofRoutes(
      queuedDb([[storedExpired], [], [], [], []]) as never,
    ).find((item) => item.path === '/api/v1/verify/hash')!;
    const hashOutput = (await hashRoute.handler(
      {} as never,
      { hash: 'original-hash' },
      {},
    )) as { status: string };
    assert.equal(hashOutput.status, 'expired');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});


test('proof-service rejects unauthenticated internal HTTP calls', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'proof-test-token';
  const server = startService('proof-service', 0, proofRoutes({} as never));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/internal/proofs/manifests`,
      { method: 'POST', body: '{}' },
    );
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { ingestionRoutes } from './index.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('document-ingestion-gateway exposes §14.3 ingestion route', () => {
  const paths = ingestionRoutes().map((r) => `${r.method} ${r.path}`);
  assert.ok(paths.includes('POST /internal/ingestion/documents'));
});

test('missing contentBase64 returns 400 missing_content', async () => {
  const routes = ingestionRoutes();
  const route = routes.find((r) => r.path === '/internal/ingestion/documents')!;
  const out = (await route.handler({} as never, {}, {})) as {
    status: number;
    body: { error: string };
  };
  assert.equal(out.status, 400);
  assert.equal(out.body.error, 'missing_content');
});

test('orchestrates paperless → canonicalization → proof and returns the manifest', async () => {
  type AuditEmit = {
    eventType?: string;
    action?: string;
    target?: { type?: string; id?: string };
    data?: { paperlessDocumentId?: string; originalFilename?: string; documentClass?: string };
  };
  const calls: string[] = [];
  const auditEmits: AuditEmit[] = [];
  const authenticatedCalls: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/internal/')) authenticatedCalls.push(init ?? {});
    if (u.endsWith('/internal/paperless/consume')) {
      return new Response(
        JSON.stringify({
          id: 'paperless-stub-abc',
          originalMime: 'application/pdf',
          originalBytes: 9,
          metadata: { consumedAt: 'now', source: 'stub' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.endsWith('/internal/canonicalization/canonicalize')) {
      return new Response(
        JSON.stringify({
          originalFileHash: 'hash-orig',
          canonicalPdfHash: 'hash-orig',
          ocrTextHash: 'hash-ocr',
          metadataHash: 'hash-meta',
          manifestHash: 'hash-manifest',
          algorithm: 'sha256',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.endsWith('/internal/proofs/manifests')) {
      return new Response(
        JSON.stringify({
          id: 'proof-1',
          schemaVersion: 'pi-doc-proof-v1',
          hashes: { originalFileHash: 'hash-orig', manifestHash: 'hash-manifest' },
          registryStatus: 'active',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.endsWith('/internal/audit/events')) {
      if (init?.body) auditEmits.push(JSON.parse(String(init.body)) as AuditEmit);
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;

  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'ingestion-test-token';
  try {
    const routes = ingestionRoutes();
    const route = routes.find((r) => r.path === '/internal/ingestion/documents')!;
    const out = (await route.handler(
      {} as never,
      {
        contentBase64: b64('%PDF-demo'),
        filename: 'demo.pdf',
        mime: 'application/pdf',
        contentVisibility: 'restricted',
        proofVisibility: 'public',
      },
      {},
    )) as { status: number; body: { id: string; hashes: { originalFileHash: string } } };
    assert.equal(out.status, 201);
    assert.equal(out.body.id, 'proof-1');
    assert.equal(out.body.hashes.originalFileHash, 'hash-orig');
    assert.equal(calls.length, 4);
    assert.ok(
      calls.some((c) => c.endsWith('/internal/audit/events')),
      'document.paperless.linked audit emit fired',
    );
    const audit = auditEmits[0];
    assert.equal(audit?.eventType, 'document.paperless.linked');
    assert.equal(audit?.action, 'link');
    assert.equal(audit?.target?.type, 'document');
    assert.equal(audit?.target?.id, 'paperless-stub-abc');
    assert.equal(audit?.data?.paperlessDocumentId, 'paperless-stub-abc');
    assert.ok(
      authenticatedCalls.every(
        (init) =>
          new Headers(init.headers).get('x-polis-internal-token') === 'ingestion-test-token',
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('rejects invalid ingestion input before any upstream call', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('unexpected upstream call');
  }) as typeof globalThis.fetch;
  const valid = {
    contentBase64: b64('%PDF-demo'),
    filename: 'demo.pdf',
    mime: 'application/pdf',
    contentVisibility: 'restricted',
    proofVisibility: 'public',
  };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...valid, contentBase64: 'not base64!' }, 'invalid_base64'],
    [{ ...valid, filename: '../demo.pdf' }, 'unsafe_filename'],
    [{ ...valid, mime: 'text/plain' }, 'invalid_mime'],
    [{ ...valid, mime: 'image/png' }, 'mime_mismatch'],
    [{ ...valid, contentVisibility: undefined }, 'missing_visibility'],
    [{ ...valid, contentVisibility: 'unknown' }, 'invalid_content_visibility'],
    [{ ...valid, proofVisibility: 'unknown' }, 'invalid_proof_visibility'],
  ];
  try {
    const route = ingestionRoutes().find((item) => item.path === '/internal/ingestion/documents')!;
    for (const [input, expectedError] of cases) {
      const output = (await route.handler({} as never, input, {})) as {
        status: number;
        body: { error: string };
      };
      assert.equal(output.status, 400);
      assert.equal(output.body.error, expectedError);
    }

    const previousMax = process.env.DOCUMENT_MAX_UPLOAD_BYTES;
    process.env.DOCUMENT_MAX_UPLOAD_BYTES = '4';
    try {
      const cappedRoute = ingestionRoutes().find(
        (item) => item.path === '/internal/ingestion/documents',
      )!;
      const output = (await cappedRoute.handler({} as never, valid, {})) as {
        status: number;
        body: { error: string };
      };
      assert.equal(output.status, 400);
      assert.equal(output.body.error, 'upload_too_large');
      assert.ok((cappedRoute.maxBodyBytes ?? 0) > 4);
    } finally {
      if (previousMax === undefined) delete process.env.DOCUMENT_MAX_UPLOAD_BYTES;
      else process.env.DOCUMENT_MAX_UPLOAD_BYTES = previousMax;
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('document-ingestion-gateway rejects unauthenticated internal HTTP calls', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'ingestion-test-token';
  const server = startService('document-ingestion-gateway', 0, ingestionRoutes());
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/internal/ingestion/documents`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

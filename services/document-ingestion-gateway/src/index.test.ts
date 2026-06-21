import test from 'node:test';
import assert from 'node:assert/strict';
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
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/internal/paperless/consume')) {
      return new Response(
        JSON.stringify({
          id: 'paperless-stub-abc',
          originalMime: 'text/plain',
          originalBytes: 5,
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
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;

  try {
    const routes = ingestionRoutes();
    const route = routes.find((r) => r.path === '/internal/ingestion/documents')!;
    const out = (await route.handler(
      {} as never,
      { contentBase64: b64('hello'), filename: 'demo.txt' },
      {},
    )) as { status: number; body: { id: string; hashes: { originalFileHash: string } } };
    assert.equal(out.status, 201);
    assert.equal(out.body.id, 'proof-1');
    assert.equal(out.body.hashes.originalFileHash, 'hash-orig');
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

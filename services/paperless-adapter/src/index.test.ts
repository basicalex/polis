import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { paperlessRoutes } from './index.js';
import {
  StubPaperlessClient,
  HttpPaperlessClient,
  PaperlessArchiveTooLargeError,
  createPaperlessClient,
} from './paperless-client.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('paperless-adapter exposes §23.9 consume + document routes', () => {
  const paths = paperlessRoutes(new StubPaperlessClient()).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/paperless/consume',
    'GET /internal/paperless/documents/:id',
    'GET /internal/paperless/documents/:id/original',
    'GET /internal/paperless/documents/:id/archive',
    'GET /internal/paperless/documents/:id/metadata',
    'POST /internal/paperless/documents/:id/reprocess',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

test('consume route derives its body cap from DOCUMENT_MAX_UPLOAD_BYTES', () => {
  const previousMax = process.env.DOCUMENT_MAX_UPLOAD_BYTES;
  process.env.DOCUMENT_MAX_UPLOAD_BYTES = '6';
  try {
    const route = paperlessRoutes(new StubPaperlessClient()).find(
      (candidate) => candidate.path === '/internal/paperless/consume',
    );
    assert.ok(route);
    assert.equal(route.maxBodyBytes, Math.ceil(6 / 3) * 4 + 16 * 1024);
  } finally {
    if (previousMax === undefined) delete process.env.DOCUMENT_MAX_UPLOAD_BYTES;
    else process.env.DOCUMENT_MAX_UPLOAD_BYTES = previousMax;
  }
});

test('StubPaperlessClient.consume returns a doc with id + ocrText', async () => {
  const client = new StubPaperlessClient();
  const doc = await client.consume({
    contentBase64: b64('demo document bytes'),
    filename: 'demo.txt',
    documentClass: 'public-government-record',
  });
  assert.match(doc.id, /^paperless-stub-/);
  assert.equal(doc.originalBytes, 'demo document bytes'.length);
  assert.equal(doc.ocrText, 'Stub OCR for demo.txt');
  assert.equal(doc.metadata.documentClass, 'public-government-record');
});

test('fetchDocument round-trips a consumed id and rejects unknown ids', async () => {
  const client = new StubPaperlessClient();
  const consumed = await client.consume({
    contentBase64: b64('round-trip'),
    filename: null,
    documentClass: null,
  });
  const fetched = await client.fetchDocument(consumed.id);
  assert.ok(fetched, 'consumed id must be fetchable');
  assert.equal(fetched?.id, consumed.id);
  const unknown = await client.fetchDocument('does-not-exist');
  assert.equal(unknown, null);
});

// ── createPaperlessClient mode resolution ──────────────────────────────────
// Env is saved/restored around every case so the suite is order-independent.

test('createPaperlessClient defaults to stub when PAPERLESS_MODE is unset', () => {
  const savedMode = process.env.PAPERLESS_MODE;
  delete process.env.PAPERLESS_MODE;
  try {
    assert.ok(createPaperlessClient() instanceof StubPaperlessClient);
  } finally {
    if (savedMode !== undefined) process.env.PAPERLESS_MODE = savedMode;
  }
});

test('createPaperlessClient resolves PAPERLESS_MODE=stub to StubPaperlessClient', () => {
  const savedMode = process.env.PAPERLESS_MODE;
  process.env.PAPERLESS_MODE = 'stub';
  try {
    assert.ok(createPaperlessClient() instanceof StubPaperlessClient);
  } finally {
    if (savedMode !== undefined) process.env.PAPERLESS_MODE = savedMode;
    else delete process.env.PAPERLESS_MODE;
  }
});

test('createPaperlessClient resolves PAPERLESS_MODE=http to HttpPaperlessClient when token is set', () => {
  const savedMode = process.env.PAPERLESS_MODE;
  const savedToken = process.env.PAPERLESS_API_TOKEN;
  process.env.PAPERLESS_MODE = 'http';
  process.env.PAPERLESS_API_TOKEN = 'test-token';
  try {
    // ctor validates env and stores fields — no network is touched.
    assert.ok(createPaperlessClient() instanceof HttpPaperlessClient);
  } finally {
    if (savedMode !== undefined) process.env.PAPERLESS_MODE = savedMode;
    else delete process.env.PAPERLESS_MODE;
    if (savedToken !== undefined) process.env.PAPERLESS_API_TOKEN = savedToken;
    else delete process.env.PAPERLESS_API_TOKEN;
  }
});

test('HttpPaperlessClient ctor requires PAPERLESS_API_TOKEN in http mode', () => {
  const savedMode = process.env.PAPERLESS_MODE;
  const savedToken = process.env.PAPERLESS_API_TOKEN;
  process.env.PAPERLESS_MODE = 'http';
  delete process.env.PAPERLESS_API_TOKEN;
  try {
    // Env validated at construction — fails before any network call.
    assert.throws(() => createPaperlessClient(), /PAPERLESS_API_TOKEN/);
  } finally {
    if (savedMode !== undefined) process.env.PAPERLESS_MODE = savedMode;
    else delete process.env.PAPERLESS_MODE;
    if (savedToken !== undefined) process.env.PAPERLESS_API_TOKEN = savedToken;
    else delete process.env.PAPERLESS_API_TOKEN;
  }
});

test('createPaperlessClient throws on an unsupported mode', () => {
  const savedMode = process.env.PAPERLESS_MODE;
  process.env.PAPERLESS_MODE = 'bad';
  try {
    assert.throws(() => createPaperlessClient(), /not supported/);
  } finally {
    if (savedMode !== undefined) process.env.PAPERLESS_MODE = savedMode;
    else delete process.env.PAPERLESS_MODE;
  }
});

test('archive route returns exact consumed bytes with MIME', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'paperless-test-token';
  const client = new StubPaperlessClient();
  const expected = new Uint8Array([0, 255, 1, 2, 3]);
  const document = await client.consume({
    contentBase64: Buffer.from(expected).toString('base64'),
    filename: 'signed.pdf',
    documentClass: 'signed-charter',
  });
  const server = startService('paperless-adapter', 0, paperlessRoutes(client));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/internal/paperless/documents/${document.id}/archive`,
      { headers: { 'x-polis-internal-token': 'paperless-test-token' } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('HttpPaperlessClient retrieves unmodified archive bytes and MIME', async () => {
  const previousToken = process.env.PAPERLESS_API_TOKEN;
  const previousUrl = process.env.PAPERLESS_BASE_URL;
  process.env.PAPERLESS_API_TOKEN = 'paperless-api-token';
  process.env.PAPERLESS_BASE_URL = 'http://paperless.test';
  const originalFetch = globalThis.fetch;
  const expected = new Uint8Array([37, 80, 68, 70, 45, 0, 255]);
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), 'http://paperless.test/api/documents/42/download/');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Token paperless-api-token');
    return new Response(expected, {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
  }) as typeof globalThis.fetch;
  try {
    const archive = await new HttpPaperlessClient().fetchArchive('42');
    assert.ok(archive);
    assert.equal(archive.mime, 'application/pdf');
    assert.deepEqual(archive.bytes, expected);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.PAPERLESS_API_TOKEN;
    else process.env.PAPERLESS_API_TOKEN = previousToken;
    if (previousUrl === undefined) delete process.env.PAPERLESS_BASE_URL;
    else process.env.PAPERLESS_BASE_URL = previousUrl;
  }
});

test('HttpPaperlessClient rejects an oversized archive from Content-Length', async () => {
  const previousToken = process.env.PAPERLESS_API_TOKEN;
  const previousMax = process.env.DOCUMENT_MAX_UPLOAD_BYTES;
  const originalFetch = globalThis.fetch;
  process.env.PAPERLESS_API_TOKEN = 'paperless-api-token';
  process.env.DOCUMENT_MAX_UPLOAD_BYTES = '4';
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      status: 200,
      headers: { 'content-length': '5' },
    })) as typeof globalThis.fetch;
  try {
    await assert.rejects(
      new HttpPaperlessClient().fetchArchive('42'),
      (error) =>
        error instanceof PaperlessArchiveTooLargeError &&
        error.code === 'paperless_archive_too_large' &&
        error.maxBytes === 4,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.PAPERLESS_API_TOKEN;
    else process.env.PAPERLESS_API_TOKEN = previousToken;
    if (previousMax === undefined) delete process.env.DOCUMENT_MAX_UPLOAD_BYTES;
    else process.env.DOCUMENT_MAX_UPLOAD_BYTES = previousMax;
  }
});

test('HttpPaperlessClient cancels a chunked archive when streamed bytes exceed the cap', async () => {
  const previousToken = process.env.PAPERLESS_API_TOKEN;
  const previousMax = process.env.DOCUMENT_MAX_UPLOAD_BYTES;
  const originalFetch = globalThis.fetch;
  process.env.PAPERLESS_API_TOKEN = 'paperless-api-token';
  process.env.DOCUMENT_MAX_UPLOAD_BYTES = '4';
  let cancelled = false;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    )) as typeof globalThis.fetch;
  try {
    await assert.rejects(
      new HttpPaperlessClient().fetchArchive('42'),
      (error) => error instanceof PaperlessArchiveTooLargeError && error.maxBytes === 4,
    );
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.PAPERLESS_API_TOKEN;
    else process.env.PAPERLESS_API_TOKEN = previousToken;
    if (previousMax === undefined) delete process.env.DOCUMENT_MAX_UPLOAD_BYTES;
    else process.env.DOCUMENT_MAX_UPLOAD_BYTES = previousMax;
  }
});

test('paperless-adapter rejects unauthenticated internal HTTP calls', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'paperless-test-token';
  const server = startService('paperless-adapter', 0, paperlessRoutes(new StubPaperlessClient()));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/internal/paperless/documents/missing/archive`,
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

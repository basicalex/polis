import test from 'node:test';
import assert from 'node:assert/strict';
import { paperlessRoutes } from './index.js';
import { StubPaperlessClient, HttpPaperlessClient, createPaperlessClient } from './paperless-client.js';

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

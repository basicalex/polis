import test from 'node:test';
import assert from 'node:assert/strict';
import { paperlessRoutes } from './index.js';
import { StubPaperlessClient, createPaperlessClient } from './paperless-client.js';

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

test('createPaperlessClient throws on unsupported mode', () => {
  process.env.PAPERLESS_MODE = 'http';
  try {
    assert.throws(() => createPaperlessClient(), /not supported in M3/);
  } finally {
    delete process.env.PAPERLESS_MODE;
  }
});

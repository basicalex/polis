import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizationRoutes, canonicalize } from './index.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('canonicalization-service exposes §9.11 canonicalize route', () => {
  const paths = canonicalizationRoutes().map((r) => `${r.method} ${r.path}`);
  assert.ok(paths.includes('POST /internal/canonicalization/canonicalize'));
});

test('same content yields the same hash bundle', async () => {
  const a = await canonicalize(b64('same bytes'), { foo: 1 });
  const b = await canonicalize(b64('same bytes'), { foo: 1 });
  assert.deepEqual(a, b);
  assert.equal(a.algorithm, 'sha256');
  assert.equal(a.canonicalPdfHash, a.originalFileHash);
});

test('manifestHash is deterministic across calls', async () => {
  const a = await canonicalize(b64('deterministic'), null);
  const b = await canonicalize(b64('deterministic'), null);
  assert.equal(a.manifestHash, b.manifestHash);
});

test('different content yields a different originalFileHash', async () => {
  const a = await canonicalize(b64('content-a'), null);
  const b = await canonicalize(b64('content-b'), null);
  assert.notEqual(a.originalFileHash, b.originalFileHash);
  assert.notEqual(a.manifestHash, b.manifestHash);
});

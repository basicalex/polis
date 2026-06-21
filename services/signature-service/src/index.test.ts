import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureRoutes } from './index.js';

test('signature-service exposes §9.13 signature routes', () => {
  const paths = signatureRoutes({} as never, {} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/signatures',
    'GET /internal/signatures/:proofId',
    'GET /internal/issuers/:id',
    'GET /healthz',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

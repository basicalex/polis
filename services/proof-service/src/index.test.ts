import test from 'node:test';
import assert from 'node:assert/strict';
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

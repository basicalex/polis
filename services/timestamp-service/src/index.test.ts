import test from 'node:test';
import assert from 'node:assert/strict';
import { timestampRoutes } from './index.js';

test('timestamp-service exposes §9.14 timestamp routes', () => {
  const paths = timestampRoutes({} as never, {} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/timestamps',
    'GET /internal/timestamps/:proofId',
    'GET /healthz',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

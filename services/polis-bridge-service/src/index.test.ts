import test from 'node:test';
import assert from 'node:assert/strict';
import { polisRoutes } from './index.js';
import { StubPolisClient } from './polis-client.js';

test('polis-bridge-service exposes §13 issues + conversation + internal sync routes', () => {
  const paths = polisRoutes({} as never, new StubPolisClient()).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'GET /api/v1/issues',
    'GET /api/v1/issues/:id',
    'GET /api/v1/processes/:id/issues',
    'GET /api/v1/issues/:id/conversation',
    'POST /internal/polis/conversations',
    'POST /internal/polis/conversations/:id/sync',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { platformRoutes } from './index.js';

test('platform-api exposes §23 public edge routes without network calls', () => {
  const paths = platformRoutes().map((r) => `${r.method} ${r.path}`);
  assert.ok(paths.includes('GET /healthz'));
  assert.ok(paths.includes('GET /version'));
  assert.ok(paths.includes('GET /api/v1/institutions'));
  assert.ok(paths.includes('GET /api/v1/institutions/:id'));
  assert.ok(paths.includes('GET /api/v1/roles/:id'));
  assert.ok(paths.includes('GET /api/v1/processes/:id'));
  assert.ok(paths.includes('GET /api/v1/claims'));
  assert.ok(paths.includes('GET /api/v1/audit/:objectType/:objectId'));
  assert.ok(paths.includes('POST /api/v1/verify/hash'));
});

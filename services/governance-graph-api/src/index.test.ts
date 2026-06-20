import test from 'node:test';
import assert from 'node:assert/strict';
import { graphRoutes } from './index.js';

test('governance-graph-api exposes §23.1 institutions + roles + processes + traverse', () => {
  const paths = graphRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'GET /api/v1/institutions',
    'GET /api/v1/institutions/:id',
    'GET /api/v1/roles/:id',
    'GET /api/v1/processes/:id',
    'GET /api/v1/claims',
    'GET /api/v1/relationships',
    'GET /api/v1/graph/traverse',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionRoutes } from './index.js';

test('contribution-service exposes §19 contribution + M-RA filing routes', () => {
  // Handlers are lazy closures, so building the table never touches the DB
  // (mirrors governance-graph-api/src/index.test.ts).
  const paths = contributionRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /api/v1/contribute/evidence',
    'POST /api/v1/contribute/graph-edit',
    'POST /internal/review/:id/decide',
    'POST /internal/mandate-holders/:id/commitments',
    'POST /internal/commitments/:id/resolutions',
    'POST /internal/commitments/:id/questions',
    'POST /internal/commitment-questions/:id/answers',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

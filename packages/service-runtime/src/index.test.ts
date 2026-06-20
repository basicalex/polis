import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalRoutes, versionMeta } from './index.js';

test('operationalRoutes exposes the four operational endpoints', () => {
  const paths = operationalRoutes('x').map((r) => r.path);
  for (const path of ['/healthz', '/readyz', '/metrics', '/version']) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test('versionMeta carries source/build transparency fields', () => {
  const meta = versionMeta('platform-api');
  assert.equal(meta.service, 'platform-api');
  assert.ok('version' in meta && 'gitSha' in meta && 'buildTime' in meta && 'sourceUrl' in meta);
});

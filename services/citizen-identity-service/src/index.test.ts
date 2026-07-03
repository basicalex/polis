import test from 'node:test';
import assert from 'node:assert/strict';
import { identityRoutes } from './index.js';

// Handlers are lazy closures, so building the table never touches the DB.
test('citizen-identity-service exposes §21 magic-link + M10 OIDC routes', () => {
  const paths = identityRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/identity/magic-link',
    'POST /internal/identity/exchange',
    'POST /internal/identity/verify-session',
    'GET /internal/identity/citizens/:id',
    'GET /internal/identity/dev-tokens',
    'GET /internal/identity/authorize',
    'POST /internal/identity/callback',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

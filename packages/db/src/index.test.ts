import test from 'node:test';
import assert from 'node:assert/strict';
import { getClient, schema } from './index.js';

test('schema exposes the app_meta baseline table', () => {
  assert.ok(schema.appMeta, 'schema.appMeta must exist');
});

test('getClient throws when no DATABASE_URL is provided', () => {
  // empty string is falsy in our guard and must surface as an explicit error
  assert.throws(() => getClient(''), /DATABASE_URL/);
});

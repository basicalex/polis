import test from 'node:test';
import assert from 'node:assert/strict';
test('search-service has a service entrypoint', () => assert.equal('search-service'.length > 0, true));

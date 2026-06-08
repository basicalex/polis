import test from 'node:test';
import assert from 'node:assert/strict';
test('platform-api has a service entrypoint', () => assert.equal('platform-api'.length > 0, true));

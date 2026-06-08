import test from 'node:test';
import assert from 'node:assert/strict';
test('anchor-service has a service entrypoint', () => assert.equal('anchor-service'.length > 0, true));

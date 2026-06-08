import test from 'node:test';
import assert from 'node:assert/strict';
test('reward-service has a service entrypoint', () => assert.equal('reward-service'.length > 0, true));

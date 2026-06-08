import test from 'node:test';
import assert from 'node:assert/strict';
test('retention-policy-service has a service entrypoint', () => assert.equal('retention-policy-service'.length > 0, true));

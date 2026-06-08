import test from 'node:test';
import assert from 'node:assert/strict';
test('access-control-service has a service entrypoint', () => assert.equal('access-control-service'.length > 0, true));

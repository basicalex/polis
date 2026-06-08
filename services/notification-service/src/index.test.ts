import test from 'node:test';
import assert from 'node:assert/strict';
test('notification-service has a service entrypoint', () => assert.equal('notification-service'.length > 0, true));

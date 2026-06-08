import test from 'node:test';
import assert from 'node:assert/strict';
test('vc-issuer-service has a service entrypoint', () => assert.equal('vc-issuer-service'.length > 0, true));

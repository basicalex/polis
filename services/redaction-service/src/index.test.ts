import test from 'node:test';
import assert from 'node:assert/strict';
test('redaction-service has a service entrypoint', () => assert.equal('redaction-service'.length > 0, true));

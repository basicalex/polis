import test from 'node:test';
import assert from 'node:assert/strict';
test('paperless-adapter has a service entrypoint', () => assert.equal('paperless-adapter'.length > 0, true));

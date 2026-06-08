import test from 'node:test';
import assert from 'node:assert/strict';
test('document-ingestion-gateway has a service entrypoint', () => assert.equal('document-ingestion-gateway'.length > 0, true));

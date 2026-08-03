import assert from 'node:assert/strict';
import test from 'node:test';
import type { DbClient } from '@polis/db';
import { S3ArtifactStore, createArtifactStore, sha256Hex } from './artifact-store.js';

test('S3 artifact retrieval rejects bytes that do not match the stored hash', async () => {
  const source = Uint8Array.from([0, 1, 2, 255, 13, 10]);
  const wrong = Uint8Array.from([9, 9, 9]);
  const store = new S3ArtifactStore({
    endpoint: 'http://minio.test:9000',
    region: 'us-east-1',
    bucket: 'polis-private',
    accessKeyId: 'test-access',
    secretAccessKey: 'test-secret',
    pathStyle: true,
    now: () => new Date('2026-07-30T00:00:00.000Z'),
    fetch: async (_input, init) => {
      if (init?.method === 'PUT') return new Response(null, { status: 200 });
      return new Response(wrong, { status: 200, headers: { 'content-type': 'application/pdf' } });
    },
  });
  const ref = await store.put(source, {
    artifactId: 'artifact-1',
    sha256: sha256Hex(source),
    mimeType: 'application/pdf',
  });
  assert.match(ref, /^s3:/);
  assert.doesNotMatch(ref, /^https?:/);
  await assert.rejects(store.get(ref), /artifact_hash_mismatch/);
});

test('artifact store selection fails fast for incomplete S3 configuration', () => {
  assert.throws(
    () =>
      createArtifactStore({} as DbClient, {
        ARTIFACT_STORE_MODE: 's3',
        S3_ARTIFACT_ENDPOINT: 'http://minio.test',
      }),
    /configuration is incomplete/,
  );
  assert.throws(
    () => createArtifactStore({} as DbClient, { ARTIFACT_STORE_MODE: 'public-url' }),
    /Unsupported ARTIFACT_STORE_MODE/,
  );
});

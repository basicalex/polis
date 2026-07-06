import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../src/pages/', import.meta.url);

test('verifier has required v1 routes', async () => {
  const index = await readFile(new URL('index.astro', root), 'utf8');
  assert.match(index, /Polis Verifier/);
});

test('verifier verify page never uploads file bytes (spec §15.5)', async () => {
  const verify = await readFile(new URL('verify.astro', root), 'utf8');
  assert.match(verify, /VerifierFlow/);
  assert.doesNotMatch(verify, /verify\/file/);
  assert.doesNotMatch(verify, /contentBase64/);
  assert.doesNotMatch(verify, /readFileB64/);
  assert.match(verify, /never uploaded/);
});

test('verifier proof page renders from the shared verdict engine', async () => {
  await access(new URL('proofs/[id].astro', root));
  const proofPage = await readFile(new URL('proofs/[id].astro', root), 'utf8');
  assert.match(proofPage, /composeVerificationVerdict/);
  assert.match(proofPage, /ProofManifestView/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../src/pages/', import.meta.url);

async function exists(path) {
  await access(new URL(path, root));
}

test('web has required phase 1 routes', async () => {
  const index = await readFile(new URL('index.astro', root), 'utf8');
  assert.match(index, /Polis Interface/);
  await exists('governance/[jurisdiction]/index.astro');
  await exists(join('governance', '[jurisdiction]', 'institutions', '[institutionId].astro'));
  await exists(join('governance', '[jurisdiction]', 'roles', '[roleId].astro'));
  await exists(join('governance', '[jurisdiction]', 'processes', '[processId].astro'));
});

test('web has trust-experience routes', async () => {
  await exists('verify.astro');
  await exists('proofs.astro');
  await exists(join('proofs', '[id].astro'));
  await exists(join('claims', '[id].astro'));
});

test('web verify page uses the client-side hashing flow', async () => {
  const verify = await readFile(new URL('verify.astro', root), 'utf8');
  assert.match(verify, /VerifierFlow/);
  assert.doesNotMatch(verify, /verify\/file/);
  assert.doesNotMatch(verify, /contentBase64/);
});

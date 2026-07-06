import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('admin has required v1 routes', async()=>{ const index=await readFile(new URL('../src/pages/index.astro', import.meta.url),'utf8'); assert.match(index, /Reviewer Admin/); });
test('admin has drafting + login pages', async () => {
  for (const p of ['../src/pages/drafting.astro', '../src/pages/login.astro']) {
    await readFile(new URL(p, import.meta.url), 'utf8');
  }
});
test('admin drafting exposes M-RA official surfaces', async () => {
  const drafting = await readFile(new URL('../src/pages/drafting.astro', import.meta.url), 'utf8');
  assert.match(drafting, /Official drafting/);
  assert.match(drafting, /DemoBadge/);
  assert.match(drafting, /demonstration/i);
  assert.match(drafting, /verified_official/);
  assert.match(drafting, /accountability, not endorsement/);
  assert.match(drafting, /public-read/);
  assert.match(drafting, /verifiable/);
  assert.match(drafting, /\/audit/);
  assert.match(drafting, /\/proofs/);
  assert.match(drafting, /\/verify/);
  assert.match(drafting, /\/api\/v1\/mandate-holders\/' \+ f\.dataset\.mh \+ '\/commitments/);
  assert.match(drafting, /\/api\/v1\/commitments\/' \+ f\.dataset\.commitment \+ '\/resolutions/);
  assert.match(drafting, /\/api\/v1\/commitments\/' \+ c\.id \+ '\/questions/);
  assert.match(drafting, /\/api\/v1\/commitment-questions\/' \+ f\.dataset\.question \+ '\/answers/);
  assert.doesNotMatch(drafting, /body\s*=\s*[^;{}]*{[^}]*\bstatus\s*:/);
  assert.doesNotMatch(drafting, /body\.\s*status\s*=/);
});

test('admin nav exposes official drafting once', async () => {
  const base = await readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.match(base, /Official drafting/);
  assert.equal((base.match(/href="\/drafting"/g) ?? []).length, 1);
});

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

test('assistant traces are fetched by authenticated browser client only', async () => {
  const assistant = await readFile(new URL('../src/pages/assistant.astro', import.meta.url), 'utf8');
  const frontmatter = assistant.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

  assert.doesNotMatch(frontmatter, /\bfetch\s*\(/);
  assert.doesNotMatch(frontmatter, /\bawait\b/);
  assert.match(assistant, /window\.sessionStorage\.getItem\('admin_session'\)/);
  assert.match(assistant, /Authorization:\s*'Bearer '\s*\+\s*token/);
  assert.match(assistant, /fetch\(API \+ '\/api\/v1\/assistant\/traces'/);
});

test('assistant traces explain staff-only authorization failures', async () => {
  const assistant = await readFile(new URL('../src/pages/assistant.astro', import.meta.url), 'utf8');

  assert.match(assistant, /Staff access required\. Sign in with a staff account/);
  assert.match(assistant, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(assistant, /Your session is not authorized to view assistant traces/);
});

test('assistant traces render loading, empty, and API values text-safely', async () => {
  const assistant = await readFile(new URL('../src/pages/assistant.astro', import.meta.url), 'utf8');

  assert.match(assistant, /Loading assistant traces…/);
  assert.match(assistant, /No traces yet\./);
  assert.match(assistant, /document\.createElement\('td'\)/);
  assert.match(assistant, /td\.textContent = value/);
  assert.match(assistant, /rows\.replaceChildren\(\)/);
  assert.doesNotMatch(assistant, /\binnerHTML\b/);
});

test('admin nav exposes the complaints workbench once beside review', async () => {
  const base = await readFile(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.equal((base.match(/href="\/complaints"/g) ?? []).length, 1);
  assert.match(base, /href="\/review">Review<\/a>\s*<a href="\/complaints">Complaints<\/a>/);
  assert.doesNotMatch(base, /\.innerHTML\s*=/);
  assert.doesNotMatch(base, /onclick\s*=/);
});

test('admin has a complaints workbench page', async () => {
  await readFile(new URL('../src/pages/complaints.astro', import.meta.url), 'utf8');
});

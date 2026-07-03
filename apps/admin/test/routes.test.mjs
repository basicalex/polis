import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('admin has required v1 routes', async()=>{ const index=await readFile(new URL('../src/pages/index.astro', import.meta.url),'utf8'); assert.match(index, /Reviewer Admin/); });
test('admin has drafting + login pages', async () => {
  for (const p of ['../src/pages/drafting.astro', '../src/pages/login.astro']) {
    await readFile(new URL(p, import.meta.url), 'utf8');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('vault has required v1 routes', async()=>{ const index=await readFile(new URL('../src/pages/index.astro', import.meta.url),'utf8'); assert.match(index, /Citizen Vault/); });

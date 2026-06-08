import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('reward policy excludes political agreement', async()=>{ const src=await readFile(new URL('../rewards/rewards.rego', import.meta.url),'utf8'); assert.match(src,/political_agreement/); });

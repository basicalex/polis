import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProcess, createProofManifest, demoProcess, verifyProof, sha256Hex } from './index.js';

test('proof manifests verify matching active hashes only', async () => { const manifest = await createProofManifest('demo'); assert.equal(verifyProof(manifest, await sha256Hex('demo')).ok, true); assert.equal(verifyProof(manifest, await sha256Hex('other')).ok, false); });
test('assessment scores stay bounded', () => { const a = assessProcess(demoProcess); for (const d of Object.values(a.dimensions)) assert.ok(d.score >= 0 && d.score <= 1); });

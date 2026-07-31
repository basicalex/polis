import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessProcess,
  createProofManifest,
  demoProcess,
  verifyProof,
  sha256Hex,
  type CharterSigningSummary,
} from './index.js';

test('proof manifests verify matching active hashes only', async () => {
  const manifest = await createProofManifest('demo');
  assert.equal(verifyProof(manifest, await sha256Hex('demo')).ok, true);
  assert.equal(verifyProof(manifest, await sha256Hex('other')).ok, false);
});
test('assessment scores stay bounded', () => {
  const a = assessProcess(demoProcess);
  for (const d of Object.values(a.dimensions)) assert.ok(d.score >= 0 && d.score <= 1);
});

test('charter signing summary contains public-safe proof metadata only', () => {
  const summary: CharterSigningSummary = {
    charterId: 'charter-1',
    mandateHolderId: 'holder-1',
    charterVersion: 1,
    charterStatus: 'accepted',
    signingStatus: 'completed',
    signedAt: '2026-07-30T00:00:00.000Z',
    signedArtifact: {
      id: 'artifact-1',
      sha256: 'abc123',
      mimeType: 'application/pdf',
      byteCount: 42,
      filename: 'charter.pdf',
      proofManifestId: 'proof-1',
    },
  };

  assert.deepEqual(Object.keys(summary).sort(), [
    'charterId',
    'charterStatus',
    'charterVersion',
    'mandateHolderId',
    'signedArtifact',
    'signedAt',
    'signingStatus',
  ]);
  assert.equal('providerEnvelopeId' in summary, false);
  assert.equal('storageRef' in summary.signedArtifact!, false);
  assert.equal('content' in summary.signedArtifact!, false);
});

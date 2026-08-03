import test from 'node:test';
import assert from 'node:assert/strict';
import { composeVerificationVerdict } from './verdict.js';
import type { DocumentProof, ProofSignature, ProofTimestamp } from './index.js';

function signature(overrides: Partial<ProofSignature> = {}): ProofSignature {
  return {
    id: 'sig-1',
    type: 'institutional-seal',
    standard: 'eIDAS-eSeal',
    signerRef: 'signer-grad-primjer',
    certificateRef: 'cert-1',
    signatureValueRef: 'sigval-1',
    signedHash: 'a'.repeat(64),
    signedAt: '2026-07-01T00:00:00.000Z',
    validationStatus: 'valid',
    issuerId: 'issuer-1',
    ...overrides,
  };
}

function timestamp(overrides: Partial<ProofTimestamp> = {}): ProofTimestamp {
  return {
    id: 'ts-1',
    type: 'RFC3161',
    timestampRef: 'tsr-1',
    timestampedHash: 'a'.repeat(64),
    timestampedAt: '2026-07-01T00:00:00.000Z',
    validationStatus: 'valid',
    tsa: 'Grad Primjer Dev TSA',
    clockSource: 'tsa',
    ...overrides,
  };
}

function proof(overrides: Partial<DocumentProof> = {}): DocumentProof {
  return {
    id: 'proof-1',
    schemaVersion: 'pi-doc-proof-v1',
    documentClass: 'public-government-record',
    documentTypeId: 'doctype-1',
    issuer: { id: 'issuer-1', name: 'Grad Primjer' },
    hashes: {
      algorithm: 'sha256',
      originalFileHash: 'a'.repeat(64),
      canonicalPdfHash: 'b'.repeat(64),
      ocrTextHash: null,
      metadataHash: null,
      manifestHash: 'c'.repeat(64),
    },
    originalFilename: 'decision.pdf',
    originalMime: 'application/pdf',
    originalBytes: 1024,
    registryStatus: 'active',
    contentVisibility: 'public',
    proofVisibility: 'public',
    createdAt: '2026-07-01T00:00:00.000Z',
    createdByService: 'document-ingestion-gateway',
    signatures: [signature()],
    timestamps: [timestamp()],
    supersededBy: null,
    supersededAt: null,
    ...overrides,
  };
}

const MECHANISMS = ['hash', 'signature', 'timestamp', 'registry', 'issuer'];

function assertAllMechanisms(verdict: ReturnType<typeof composeVerificationVerdict>) {
  assert.deepEqual(
    verdict.checks.map((c) => c.mechanism),
    MECHANISMS,
  );
}

test('not_found when proof is null', () => {
  const v = composeVerificationVerdict({ proof: null });
  assert.equal(v.state, 'not_found');
  assert.equal(v.tone, 'unknown');
  assert.equal(v.headlineKey, 'verdict.not_found.headline');
  assert.equal(v.proofNotTruthKey, 'verdict.note.proof_not_truth');
  assertAllMechanisms(v);
  assert.ok(v.checks.every((c) => c.status === 'not_checked'));
});

test('not_found when apiStatus is not_found even with proof object', () => {
  const v = composeVerificationVerdict({ proof: proof(), apiStatus: 'not_found' });
  assert.equal(v.state, 'not_found');
});

test('private_or_restricted for private proofVisibility', () => {
  const v = composeVerificationVerdict({ proof: proof({ proofVisibility: 'private' }) });
  assert.equal(v.state, 'private_or_restricted');
  assert.equal(v.tone, 'restricted');
});

test('private_or_restricted for commitment_only proofVisibility', () => {
  const v = composeVerificationVerdict({ proof: proof({ proofVisibility: 'commitment_only' }) });
  assert.equal(v.state, 'private_or_restricted');
});

test('private_or_restricted for sealed registryStatus', () => {
  const v = composeVerificationVerdict({ proof: proof({ registryStatus: 'sealed' }) });
  assert.equal(v.state, 'private_or_restricted');
});

test('restricted precedence: never leaks failure details (§15.9)', () => {
  const v = composeVerificationVerdict({
    proof: proof({
      proofVisibility: 'private',
      signatures: [signature({ validationStatus: 'invalid' })],
      registryStatus: 'revoked',
    }),
    computedHash: 'f'.repeat(64),
  });
  assert.equal(v.state, 'private_or_restricted');
  assert.ok(v.checks.every((c) => c.status === 'not_checked'));
  assert.ok(v.checks.every((c) => c.detail === undefined));
});

test('integrity_failure when computed hash matches neither original nor canonical hash', () => {
  const v = composeVerificationVerdict({ proof: proof(), computedHash: 'f'.repeat(64) });
  assert.equal(v.state, 'integrity_failure');
  assert.equal(v.tone, 'invalid');
  assert.equal(v.checks[0].status, 'fail');
});

test('hash match against originalFileHash passes, case/whitespace-insensitive', () => {
  const v = composeVerificationVerdict({
    proof: proof(),
    computedHash: `  ${'A'.repeat(64)}  `,
  });
  assert.equal(v.state, 'valid');
  assert.equal(v.checks[0].status, 'pass');
});

test('hash match against canonicalPdfHash passes', () => {
  const v = composeVerificationVerdict({ proof: proof(), computedHash: 'b'.repeat(64) });
  assert.equal(v.state, 'valid');
});

test('signature_invalid when any signature is invalid', () => {
  const v = composeVerificationVerdict({
    proof: proof({
      signatures: [signature(), signature({ id: 'sig-2', validationStatus: 'invalid' })],
    }),
  });
  assert.equal(v.state, 'signature_invalid');
  assert.equal(v.tone, 'invalid');
  assert.equal(v.checks[1].status, 'fail');
});

test('timestamp_invalid when any timestamp is invalid', () => {
  const v = composeVerificationVerdict({
    proof: proof({ timestamps: [timestamp({ validationStatus: 'invalid' })] }),
  });
  assert.equal(v.state, 'timestamp_invalid');
  assert.equal(v.checks[2].status, 'fail');
});

test('signature_invalid takes precedence over timestamp_invalid and revoked', () => {
  const v = composeVerificationVerdict({
    proof: proof({
      signatures: [signature({ validationStatus: 'invalid' })],
      timestamps: [timestamp({ validationStatus: 'invalid' })],
      registryStatus: 'revoked',
    }),
  });
  assert.equal(v.state, 'signature_invalid');
});

test('integrity_failure takes precedence over signature_invalid', () => {
  const v = composeVerificationVerdict({
    proof: proof({ signatures: [signature({ validationStatus: 'invalid' })] }),
    computedHash: 'f'.repeat(64),
  });
  assert.equal(v.state, 'integrity_failure');
});

test('revoked registryStatus', () => {
  const v = composeVerificationVerdict({ proof: proof({ registryStatus: 'revoked' }) });
  assert.equal(v.state, 'revoked');
  assert.equal(v.tone, 'invalid');
  assert.equal(v.checks[3].status, 'fail');
});

test('valid_but_expired registryStatus', () => {
  const v = composeVerificationVerdict({ proof: proof({ registryStatus: 'expired' }) });
  assert.equal(v.state, 'valid_but_expired');
  assert.equal(v.tone, 'warning');
});

test('valid_but_superseded via registryStatus', () => {
  const v = composeVerificationVerdict({ proof: proof({ registryStatus: 'superseded' }) });
  assert.equal(v.state, 'valid_but_superseded');
  assert.equal(v.tone, 'warning');
});

test('valid_but_superseded via supersededBy pointer', () => {
  const v = composeVerificationVerdict({ proof: proof({ supersededBy: 'proof-2' }) });
  assert.equal(v.state, 'valid_but_superseded');
});

test('revoked takes precedence over superseded', () => {
  const v = composeVerificationVerdict({
    proof: proof({ registryStatus: 'revoked', supersededBy: 'proof-2' }),
  });
  assert.equal(v.state, 'revoked');
});

test('issuer_unknown when all signatures lack issuerId', () => {
  const v = composeVerificationVerdict({
    proof: proof({ signatures: [signature({ issuerId: null })] }),
  });
  assert.equal(v.state, 'issuer_unknown');
  assert.equal(v.tone, 'warning');
  assert.equal(v.checks[4].status, 'indeterminate');
});

test('no issuer_unknown when at least one signature has issuerId', () => {
  const v = composeVerificationVerdict({
    proof: proof({
      signatures: [signature({ issuerId: null }), signature({ id: 'sig-2' })],
    }),
  });
  assert.equal(v.state, 'valid');
});

test('status_unknown registryStatus', () => {
  const v = composeVerificationVerdict({ proof: proof({ registryStatus: 'unknown' }) });
  assert.equal(v.state, 'status_unknown');
  assert.equal(v.tone, 'warning');
  assert.equal(v.checks[3].status, 'indeterminate');
});

test('issuer_unknown takes precedence over status_unknown', () => {
  const v = composeVerificationVerdict({
    proof: proof({ registryStatus: 'unknown', signatures: [signature({ issuerId: null })] }),
  });
  assert.equal(v.state, 'issuer_unknown');
});

test('valid: everything checks out, all five mechanisms reported', () => {
  const v = composeVerificationVerdict({ proof: proof(), computedHash: 'a'.repeat(64) });
  assert.equal(v.state, 'valid');
  assert.equal(v.tone, 'valid');
  assertAllMechanisms(v);
  assert.deepEqual(
    v.checks.map((c) => c.status),
    ['pass', 'pass', 'pass', 'pass', 'pass'],
  );
});

test('hash check is not_checked when verdict comes from proof-id lookup', () => {
  const v = composeVerificationVerdict({ proof: proof() });
  assert.equal(v.checks[0].status, 'not_checked');
  assert.equal(v.state, 'valid');
});

test('empty signatures → signature not_present, issuer not_checked, still valid', () => {
  const v = composeVerificationVerdict({ proof: proof({ signatures: [] }) });
  assert.equal(v.checks[1].status, 'not_present');
  assert.equal(v.checks[4].status, 'not_checked');
  assert.equal(v.state, 'valid');
});

test('empty timestamps → timestamp not_present, still valid', () => {
  const v = composeVerificationVerdict({ proof: proof({ timestamps: [] }) });
  assert.equal(v.checks[2].status, 'not_present');
  assert.equal(v.state, 'valid');
});

test('indeterminate signature status does not fail verdict but is reported', () => {
  const v = composeVerificationVerdict({
    proof: proof({ signatures: [signature({ validationStatus: 'indeterminate' })] }),
  });
  assert.equal(v.state, 'valid');
  assert.equal(v.checks[1].status, 'indeterminate');
});

test('not_checked signature status is reported as not_checked', () => {
  const v = composeVerificationVerdict({
    proof: proof({ signatures: [signature({ validationStatus: 'not_checked' })] }),
  });
  assert.equal(v.checks[1].status, 'not_checked');
});

test('test-key signature forces §15.7 label and adds explanation note', () => {
  const v = composeVerificationVerdict({
    proof: proof({ signatures: [signature({ standard: 'test-key' })] }),
  });
  assert.equal(v.state, 'valid');
  assert.equal(v.checks[1].labelKey, 'check.signature.test_key');
  assert.ok(v.explanationKeys.includes('verdict.note.test_signature'));
});

test('every verdict carries the proof-not-truth note key (§15.4)', () => {
  const variants = [
    composeVerificationVerdict({ proof: null }),
    composeVerificationVerdict({ proof: proof() }),
    composeVerificationVerdict({ proof: proof({ registryStatus: 'revoked' }) }),
    composeVerificationVerdict({ proof: proof({ proofVisibility: 'private' }) }),
  ];
  for (const v of variants) {
    assert.equal(v.proofNotTruthKey, 'verdict.note.proof_not_truth');
    assert.equal(v.explanationKeys[0], `verdict.${v.state}.explanation`);
  }
});

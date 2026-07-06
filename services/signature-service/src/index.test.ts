import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { signatureRoutes } from './index.js';
import { StubSignerClient, DssSignerClient, createSignerClient } from './signer-client.js';

test('signature-service exposes §9.13 signature routes', () => {
  const paths = signatureRoutes({} as never, {} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/signatures',
    'GET /internal/signatures/:proofId',
    'GET /internal/issuers/:id',
    'GET /healthz',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

// ── createSignerClient mode resolution ────────────────────────────────────
// Env is saved/restored around every case so the suite is order-independent.

test('createSignerClient defaults to stub when SIGNATURE_MODE is unset', () => {
  const savedMode = process.env.SIGNATURE_MODE;
  delete process.env.SIGNATURE_MODE;
  try {
    assert.ok(createSignerClient() instanceof StubSignerClient);
  } finally {
    if (savedMode !== undefined) process.env.SIGNATURE_MODE = savedMode;
  }
});

test('createSignerClient resolves SIGNATURE_MODE=stub to StubSignerClient', () => {
  const savedMode = process.env.SIGNATURE_MODE;
  process.env.SIGNATURE_MODE = 'stub';
  try {
    assert.ok(createSignerClient() instanceof StubSignerClient);
  } finally {
    if (savedMode !== undefined) process.env.SIGNATURE_MODE = savedMode;
    else delete process.env.SIGNATURE_MODE;
  }
});

test('createSignerClient resolves SIGNATURE_MODE=real to DssSignerClient (committed dev cert, no network)', () => {
  const savedMode = process.env.SIGNATURE_MODE;
  process.env.SIGNATURE_MODE = 'real';
  try {
    // The dev cert PEMs ship committed, so constructing the client + loading
    // them is network-free (CMS is produced in-process). No throw expected.
    assert.ok(createSignerClient() instanceof DssSignerClient);
  } finally {
    if (savedMode !== undefined) process.env.SIGNATURE_MODE = savedMode;
    else delete process.env.SIGNATURE_MODE;
  }
});

test('createSignerClient throws on an unsupported mode', () => {
  const savedMode = process.env.SIGNATURE_MODE;
  process.env.SIGNATURE_MODE = 'bad';
  try {
    assert.throws(() => createSignerClient(), /not supported/);
  } finally {
    if (savedMode !== undefined) process.env.SIGNATURE_MODE = savedMode;
    else delete process.env.SIGNATURE_MODE;
  }
});

// ── DssSignerClient CMS sign→validate round-trip (real crypto, in-process) ─

test('DssSignerClient produces a real eIDAS-eSeal CMS signature that validates', async () => {
  const signer = new DssSignerClient();
  const hash = createHash('sha256').update('polis m12 acceptance manifest').digest('hex');
  const signed = await signer.sign({
    proofId: 'proof-m12-test',
    hash,
    issuerId: 'issuer-dev-seal',
  });

  // Real-mode discriminators (≠ stub test-key / test-signer-stub-ed25519).
  assert.equal(signed.standard, 'eIDAS-eSeal');
  assert.notEqual(signed.signerRef, 'test-signer-stub-ed25519');
  assert.equal(signed.signerRef, 'polis-dev-institutional-seal-v1');
  // Self-verify ran at sign time and must report valid.
  assert.equal(signed.validationStatus, 'valid');
  // A non-empty CMS token (base64 DER ContentInfo).
  assert.ok(signed.signatureValueRef.length > 0);
  assert.ok(signed.certificateRef && /^[0-9a-f]{64}$/.test(signed.certificateRef));

  // validate() independently parses + verifies the CMS signature against the
  // dev cert and asserts the embedded eContent equals the hash.
  assert.equal(await signer.validate(signed.signatureValueRef, hash), 'valid');

  // Tamper gate: a different hash must NOT validate against the same signature.
  const tampered = createHash('sha256').update('different content').digest('hex');
  assert.equal(await signer.validate(signed.signatureValueRef, tampered), 'invalid');
});

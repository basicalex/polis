/**
 * @polis/signature-service — signature/e-seal seam (spec §9.13 + §15.7).
 *
 * The only M4 implementation is {@link StubSignerClient}; a real adapter
 * (EU DSS / qualified TSP) lands when issuer key management is wired.
 * {@link createSignerClient} is the single seam — SIGNATURE_MODE=real throws
 * until that milestone so a misconfigured deploy fails fast rather than
 * silently falling back. Mirrors the M3 Paperless stub rule.
 *
 * §15.7: test keys are allowed with obvious labels. The stub signs with a
 * hardcoded Ed25519 test keypair labelled `test-key` / `test-signer-stub-ed25519`;
 * it is never a legally meaningful signature.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/** §15.7 test keypair (Ed25519). Generated and roundtrip-verified for M4. */
const PRIV_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIFj9NIAjxO9pNprl3eSn4Tlc+QRO6yjAQ90XC4Gp5Lrl
-----END PRIVATE KEY-----`;

const PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAa6TMltWLo/cPvizBYVuyLnqWqP2UZAKXhNKL2F8svlM=
-----END PUBLIC KEY-----`;

const SIGNER_REF = 'test-signer-stub-ed25519';

export type SignInput = { proofId: string; hash: string; issuerId: string; issuerName?: string };

/**
 * Cryptographic material produced by {@link SignerClient.sign}. The DB row
 * (id, validationStatus) is assigned by the route at insert; this is the pure
 * crypto payload the route writes under `proof_signatures`.
 */
export type SignResult = {
  type: 'institutional-seal';
  standard: 'test-key';
  signerRef: string;
  certificateRef: null;
  signatureValueRef: string;
  signedHash: string;
  signedAt: string;
  validationStatus: 'valid';
};

export interface SignerClient {
  sign(input: SignInput): Promise<SignResult>;
  validate(signatureValueRef: string, hash: string): Promise<'valid' | 'invalid'>;
}

/**
 * Deterministic Ed25519 stub. No network. `sign` returns the base64-encoded
 * 64-byte signature as `signatureValueRef` (Ed25519 has no separate algorithm
 * parameter — `crypto.sign(null, …)`); `validate` re-derives the public key
 * from the embedded test public key and verifies the signature against the
 * hash. A mismatch returns `'invalid'` rather than throwing.
 */
export class StubSignerClient implements SignerClient {
  async sign(input: SignInput): Promise<SignResult> {
    const privKey = createPrivateKey(PRIV_PEM);
    const data = Buffer.from(input.hash, 'hex');
    const signatureValueRef = sign(null, data, privKey).toString('base64');
    return {
      type: 'institutional-seal',
      standard: 'test-key',
      signerRef: SIGNER_REF,
      certificateRef: null,
      signatureValueRef,
      signedHash: input.hash,
      signedAt: new Date().toISOString(),
      validationStatus: 'valid',
    };
  }

  async validate(signatureValueRef: string, hash: string): Promise<'valid' | 'invalid'> {
    try {
      const pubKey = createPublicKey(PUB_PEM);
      const data = Buffer.from(hash, 'hex');
      const sig = Buffer.from(signatureValueRef, 'base64');
      return verify(null, data, pubKey, sig) ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
}

/**
 * Resolve the signer adapter from SIGNATURE_MODE. Only 'stub' (default) is
 * supported in M4; any other value throws a clear error naming the milestone
 * that ships the real adapter.
 */
export function createSignerClient(): SignerClient {
  const mode = process.env.SIGNATURE_MODE ?? 'stub';
  if (mode === 'stub') return new StubSignerClient();
  throw new Error(
    `SIGNATURE_MODE=${mode} is not supported in M4; lands when EU DSS / qualified TSP integration is wired`,
  );
}

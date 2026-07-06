/**
 * @polis/signature-service — signature/e-seal seam (spec §9.13 + §15.7).
 *
 * Two implementations: {@link StubSignerClient} (M4, frozen dev path, no
 * network — default) and {@link DssSignerClient} (M12, real CMS/PKCS#7 e-seal
 * with a committed dev institutional cert — SIGNATURE_MODE=real). {@link
 * createSignerClient} is the single seam; any unknown mode throws so a
 * misconfigured deploy fails fast rather than silently falling back. Mirrors
 * the M3/M11 Paperless stub rule.
 *
 * §15.7: test keys are allowed with obvious labels. The stub signs with a
 * hardcoded Ed25519 test keypair labelled `test-key` / `test-signer-stub-ed25519`;
 * the real adapter produces a CMS SignedData e-seal with a committed dev P-256
 * cert whose CN carries the "NOT LEGALLY MEANINGFUL" label (standard `eIDAS-eSeal`,
 * signerRef `polis-dev-institutional-seal-v1`). Neither is a legally meaningful
 * signature; production swaps a real DSS/TSP behind the same seam.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  webcrypto,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OctetString, fromBER } from 'asn1js';
import {
  Certificate,
  ContentInfo,
  EncapsulatedContentInfo,
  IssuerAndSerialNumber,
  SignedData,
  SignerInfo,
  setEngine,
} from 'pkijs';

// pkijs 3.x is WebCrypto-based; wire Node's built-in subtle once at module load.
// Cast through `unknown`: Node's webcrypto types carry extra KeyUsage values
// vs the DOM lib types pkijs is declared against; structurally compatible at
// runtime (the engine only uses standard subtle ops).
const nwCrypto = webcrypto as unknown as Crypto;
setEngine('node', nwCrypto, nwCrypto.subtle);

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
  standard: 'test-key' | 'eIDAS-eSeal';
  signerRef: string;
  certificateRef: string | null;
  signatureValueRef: string;
  signedHash: string;
  signedAt: string;
  validationStatus: 'valid' | 'invalid';
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

/** Loaded + cached dev institutional cert/key (parsed once per process). */
interface DevSealMaterial {
  cert: Certificate;
  certFingerprint: string;
  privateKey: CryptoKey;
}

let devSealCache: DevSealMaterial | null = null;

/** Parse a PEM to its base64 DER bytes. */
const pemToDer = (pem: string): Uint8Array<ArrayBuffer> => {
  const buf = Buffer.from(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, ''), 'base64');
  // Backed by a concrete ArrayBuffer (not ArrayBufferLike) so it satisfies the
  // DOM BufferSource type pkijs/SubtleCrypto expect.
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
};

/**
 * Load + cache the committed dev institutional seal (§15.7). The committed PEMs
 * are the default; `SIGNATURE_DEV_CERT_PATH` / `SIGNATURE_DEV_KEY_PATH` override.
 * Throws if the cert/key cannot be parsed so a misconfigured real mode fails fast.
 */
async function loadDevSeal(): Promise<DevSealMaterial> {
  if (devSealCache) return devSealCache;
  const certPath =
    process.env.SIGNATURE_DEV_CERT_PATH ??
    new URL('../dev/dev-institutional-seal.crt', import.meta.url).pathname;
  const keyPath =
    process.env.SIGNATURE_DEV_KEY_PATH ??
    new URL('../dev/dev-institutional-seal.key', import.meta.url).pathname;
  const certPem = readFileSync(certPath, 'utf8');
  const keyPem = readFileSync(keyPath, 'utf8');
  const certDer = pemToDer(certPem);
  const cert = new Certificate({ schema: fromBER(certDer).result });
  const privateKey = await nwCrypto.subtle.importKey(
    'pkcs8',
    pemToDer(keyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const certFingerprint = createHash('sha256').update(certDer).digest('hex');
  devSealCache = { cert, certFingerprint, privateKey };
  return devSealCache;
}

/**
 * Real CMS/PKCS#7 e-seal adapter (M12). Activated by SIGNATURE_MODE=real.
 *
 * Produces a genuine detached-content `SignedData` (RFC 5652) over the manifest
 * hash with the committed dev P-256 cert. `signatureValueRef` is the base64 DER
 * of the wrapping `ContentInfo`; `standard='eIDAS-eSeal'` is the real-mode
 * discriminator (≠ stub `test-key`), and `signerRef='polis-dev-institutional-seal-v1'`
 * + the cert CN carry the "NOT LEGALLY MEANINGFUL" label. `validate` parses the
 * stored token, verifies the CMS signature against the dev cert, and asserts the
 * embedded eContent equals `hash`. In-process — no backing service.
 */
export class DssSignerClient implements SignerClient {
  async sign(input: SignInput): Promise<SignResult> {
    const { cert, certFingerprint, privateKey } = await loadDevSeal();
    const hashBytes = new Uint8Array(Buffer.from(input.hash, 'hex'));
    const encapContentInfo = new EncapsulatedContentInfo({
      eContentType: '1.2.840.113549.1.7.1',
      eContent: new OctetString({ valueHex: hashBytes }),
    });
    const signerInfo = new SignerInfo({
      version: 1,
      sid: new IssuerAndSerialNumber({
        issuer: cert.issuer,
        serialNumber: cert.serialNumber,
      }),
    });
    const signedData = new SignedData({
      version: 1,
      encapContentInfo,
      signerInfos: [signerInfo],
      certificates: [cert],
    });
    await signedData.sign(privateKey, 0, 'SHA-256');
    const contentInfo = new ContentInfo({
      contentType: '1.2.840.113549.1.7.2',
      content: signedData.toSchema(true),
    });
    const signatureValueRef = Buffer.from(contentInfo.toSchema().toBER(false)).toString('base64');
    // Self-verify before returning (§15.7 + plan): never claim valid on a
    // broken signature. validate already loads the dev cert + parses the token.
    const selfCheck = await this.validate(signatureValueRef, input.hash);
    return {
      type: 'institutional-seal',
      standard: 'eIDAS-eSeal',
      signerRef: 'polis-dev-institutional-seal-v1',
      certificateRef: certFingerprint,
      signatureValueRef,
      signedHash: input.hash,
      signedAt: new Date().toISOString(),
      validationStatus: selfCheck,
    };
  }

  async validate(signatureValueRef: string, hash: string): Promise<'valid' | 'invalid'> {
    try {
      const { cert } = await loadDevSeal();
      const tokenAsn1 = fromBER(Buffer.from(signatureValueRef, 'base64'));
      const token = new ContentInfo({ schema: tokenAsn1.result });
      const signedData = new SignedData({ schema: token.content });

      const verified = await signedData.verify({
        signer: 0,
        trustedCerts: [cert],
        checkChain: false,
      });
      if (!verified) return 'invalid';

      // The signature is only valid for the hash it sealed — compare the
      // embedded eContent (the signed hash) to the asserted hash. pkijs verify
      // does not invalidate on a `data` override when eContent is embedded, so
      // the comparison is the tamper gate.
      const eContent = signedData.encapContentInfo?.eContent;
      if (!eContent) return 'invalid';
      const embedded = Buffer.from(eContent.getValue());
      const asserted = Buffer.from(hash, 'hex');
      return embedded.equals(asserted) ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
}

/**
 * Resolve the signer adapter from SIGNATURE_MODE. 'stub' (default) is the
 * frozen dev path; 'real' (M12) is the live CMS e-seal adapter; anything else
 * throws a clear error so a misconfigured deploy fails fast rather than
 * silently falling back.
 */
export function createSignerClient(): SignerClient {
  const mode = process.env.SIGNATURE_MODE ?? 'stub';
  if (mode === 'stub') return new StubSignerClient();
  if (mode === 'real') return new DssSignerClient();
  throw new Error(`SIGNATURE_MODE=${mode} is not supported; use 'stub' or 'real'`);
}

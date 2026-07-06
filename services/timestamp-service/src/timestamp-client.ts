/**
 * @polis/timestamp-service — RFC 3161 timestamp seam (spec §9.14 + §15.6).
 *
 * Two implementations: {@link StubTimestampClient} (M4, frozen dev path, no
 * network — default) and {@link Rfc3161TimestampClient} (M12, real RFC 3161
 * adapter against a self-hosted TSA — TIMESTAMP_MODE=real). {@link
 * createTimestampClient} is the single seam; any unknown mode throws so a
 * misconfigured deploy fails fast rather than silently falling back. Mirrors
 * the M3/M11 Paperless stub rule.
 *
 * §15.6: v0.1 timestamps hashes (not documents) and stores the token plus a
 * validation result. The stub mints a deterministic base64 token derived from
 * the hash + TSA id; the real adapter posts a `TimeStampReq` (DER) to the TSA,
 * embeds the returned CMS `timeStampToken` (base64 DER) as `timestampRef`, and
 * self-validates against the TSA cert embedded in the token (`certReq=true`).
 */
import { webcrypto } from 'node:crypto';
import { Integer, Null, OctetString, fromBER } from 'asn1js';
import {
  AlgorithmIdentifier,
  ContentInfo,
  MessageImprint,
  SignedData,
  TimeStampReq,
  TimeStampResp,
  TSTInfo,
  setEngine,
} from 'pkijs';

// pkijs 3.x is WebCrypto-based; wire Node's built-in subtle once at module load.
// Cast through `unknown`: Node's webcrypto types carry extra KeyUsage values
// vs the DOM lib types pkijs is declared against; structurally compatible at
// runtime (the engine only uses standard subtle ops).
const nwCrypto = webcrypto as unknown as Crypto;
setEngine('node', nwCrypto, nwCrypto.subtle);

export type TimestampInput = { proofId: string; hash: string; algorithm?: string };

export type TimestampResult = {
  type: 'RFC3161';
  timestampRef: string;
  timestampedHash: string;
  timestampedAt: string;
  validationStatus: 'valid';
  tsa: string;
  clockSource: string;
};

export interface TimestampClient {
  requestTimestamp(input: TimestampInput): Promise<TimestampResult>;
  validate(timestampRef: string, hash: string): Promise<'valid' | 'invalid'>;
}

const STUB_TSA = 'polis-stub-tsa';
const STUB_CLOCK = 'system-clock-stub';

/**
 * Deterministic stub. No network. The token is `base64('tsa-stub:<hash>:<tsa>')`
 * so `validate` recomputes from the hash and compares. `timestampedAt` is the
 * mint time (ISO); the token carries the TSA id, not the time, so validation
 * is independent of clock drift.
 */
export class StubTimestampClient implements TimestampClient {
  async requestTimestamp(input: TimestampInput): Promise<TimestampResult> {
    const timestampedAt = new Date().toISOString();
    const timestampRef = Buffer.from(`tsa-stub:${input.hash}:${STUB_TSA}`).toString('base64');
    return {
      type: 'RFC3161',
      timestampRef,
      timestampedHash: input.hash,
      timestampedAt,
      validationStatus: 'valid',
      tsa: STUB_TSA,
      clockSource: STUB_CLOCK,
    };
  }

  async validate(timestampRef: string, hash: string): Promise<'valid' | 'invalid'> {
    try {
      const expected = Buffer.from(`tsa-stub:${hash}:${STUB_TSA}`).toString('base64');
      return timestampRef === expected ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
}

/**
 * Real RFC 3161 timestamp adapter (M12). Activated by TIMESTAMP_MODE=real.
 *
 * Posts an ASN.1 `TimeStampReq` (DER) to a TSA at `TSA_URL` with
 * `certReq=true`, so the TSA certificate is embedded in the returned
 * `timeStampToken`. The stored `timestampRef` is the base64 DER of that CMS
 * token (NOT the full `TimeStampResp`), making `validate` self-contained — it
 * parses the token, verifies the TSA signature against the embedded cert, and
 * checks the `messageImprint` hashes to `hash`.
 *
 * `TSA_URL` is required (fail-fast in the ctor, before any network). The dev
 * TSA (sigstore/timestamp-authority in compose) regenerates its key/cert each
 * boot, which is exactly why `certReq=true` + embedded-cert validation matters.
 */
export class Rfc3161TimestampClient implements TimestampClient {
  private readonly tsaUrl: string;
  private readonly tsa: string;

  constructor() {
    const tsaUrl = process.env.TSA_URL;
    if (!tsaUrl) {
      throw new Error('TSA_URL is required when TIMESTAMP_MODE=real');
    }
    this.tsaUrl = tsaUrl.replace(/\/$/, '');
    this.tsa = tsaUrl;
  }

  async requestTimestamp(input: TimestampInput): Promise<TimestampResult> {
    const hashBytes = new Uint8Array(Buffer.from(input.hash, 'hex'));
    // RFC 3161 §2.4.1: the caller supplies the hash DIGEST, not the data. The
    // manifest hash is already sha256, so build the imprint directly — do NOT
    // use MessageImprint.create(), which would hash a second time and break
    // validate() (it compares the token's hashedMessage back to input.hash).
    // SHA-256 OID 2.16.840.1.101.3.4.2.1 (explicit, type-correct form).
    const messageImprint = new MessageImprint({
      hashAlgorithm: new AlgorithmIdentifier({
        algorithmId: '2.16.840.1.101.3.4.2.1',
        algorithmParams: new Null(),
      }),
      hashedMessage: new OctetString({ valueHex: hashBytes }),
    });
    // Cryptographically random nonce (RFC 3161 §2.4.2 anti-replay value) —
    // never Math.random(). certReq=true embeds the TSA cert for self-contained
    // validation.
    const nonceBuf = new Uint8Array(16);
    webcrypto.getRandomValues(nonceBuf);
    const nonce = new Integer({ valueHex: nonceBuf });
    const request = new TimeStampReq({
      version: 1,
      messageImprint,
      nonce,
      certReq: true,
    });
    const query = request.toSchema().toBER(false);

    const response = await fetch(this.tsaUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body: query,
    });
    if (!response.ok) {
      throw new Error(`tsa_http_${response.status}`);
    }
    const respBytes = new Uint8Array(await response.arrayBuffer());
    const respAsn1 = fromBER(respBytes);
    const tsResp = new TimeStampResp({ schema: respAsn1.result });

    // PKIStatus: 0 = granted, 1 = grantedWithMods; anything else is a rejection.
    const status = tsResp.status?.status;
    if (status !== 0 && status !== 1) {
      throw new Error(`tsa_rejected_status_${status ?? 'unknown'}`);
    }
    const token = tsResp.timeStampToken;
    if (!token) {
      throw new Error('tsa_no_timeStampToken');
    }

    // genTime lives inside the TSTInfo carried as the detached eContent of the
    // token's SignedData.
    const tokenDer = token.toSchema().toBER(false);
    const tstInfo = this.extractTstInfo(tokenDer);
    const timestampedAt = (tstInfo?.genTime ?? new Date()).toISOString();
    const timestampRef = Buffer.from(tokenDer).toString('base64');

    // Self-validate at creation (§15.6 + plan): the stored token must verify
    // against the embedded TSA cert and timestamp the asserted hash. A token
    // that fails its own validation is rejected before it is ever stored.
    const selfCheck = await this.validate(timestampRef, input.hash);
    if (selfCheck !== 'valid') {
      throw new Error('tsa_token_self_validation_failed');
    }

    return {
      type: 'RFC3161',
      timestampRef,
      timestampedHash: input.hash,
      timestampedAt,
      validationStatus: 'valid',
      tsa: this.tsa,
      clockSource: 'rfc3161-tsa',
    };
  }

  async validate(timestampRef: string, hash: string): Promise<'valid' | 'invalid'> {
    try {
      const tokenDer = Buffer.from(timestampRef, 'base64');
      const tokenAsn1 = fromBER(tokenDer);
      const token = new ContentInfo({ schema: tokenAsn1.result });
      const signedData = new SignedData({ schema: token.content });

      // pkijs's high-level verify() runs an extra recursive TSTInfo check that
      // hashes the `data` argument and compares it to the imprint — incompatible
      // with RFC 3161 hash-timestamping (we timestamp the manifest hash digest
      // directly, so there is no pre-image). The CMS signature, the signedAttrs
      // signature, and the messageDigest-over-eContent are all verified by
      // verify() BEFORE that recursion, so temporarily re-label the content type
      // to id-data to skip only the incompatible pre-image check. pkijs finds
      // the TSA signer cert itself by matching signerInfos[0].sid against the
      // embedded certificates (certReq=true), so cert ordering does not matter.
      signedData.encapContentInfo.eContentType = SignedData.ID_DATA;
      const verified = await signedData.verify({ signer: 0, checkChain: false });
      if (!verified) return 'invalid';

      // The TSR is only valid for the hash it timestamped — compare the TSTInfo
      // messageImprint to the asserted hash. (This is the real §15.6 check that
      // pkijs's recursion was trying — and failing — to do for bare hashes.)
      const tstInfo = this.extractTstInfo(tokenDer);
      const embedded = tstInfo?.messageImprint?.hashedMessage?.getValue?.();
      if (!embedded) return 'invalid';
      return Buffer.from(embedded).equals(Buffer.from(hash, 'hex')) ? 'valid' : 'invalid';
    } catch {
      return 'invalid';
    }
  }

  /** Parse the CMS token → SignedData → detached TSTInfo, or null on any error. */
  private extractTstInfo(tokenDer: Buffer | ArrayBuffer): TSTInfo | null {
    try {
      const tokenAsn1 = fromBER(tokenDer);
      const token = new ContentInfo({ schema: tokenAsn1.result });
      const signedData = new SignedData({ schema: token.content });
      const eContent = signedData.encapContentInfo?.eContent;
      if (!eContent) return null;
      const tstAsn1 = fromBER(eContent.getValue());
      return new TSTInfo({ schema: tstAsn1.result });
    } catch {
      return null;
    }
  }
}

/**
 * Resolve the timestamp adapter from TIMESTAMP_MODE. 'stub' (default) is the
 * frozen dev path; 'real' (M12) is the live RFC 3161 adapter; anything else
 * throws a clear error so a misconfigured deploy fails fast rather than
 * silently falling back.
 */
export function createTimestampClient(): TimestampClient {
  const mode = process.env.TIMESTAMP_MODE ?? 'stub';
  if (mode === 'stub') return new StubTimestampClient();
  if (mode === 'real') return new Rfc3161TimestampClient();
  throw new Error(`TIMESTAMP_MODE=${mode} is not supported; use 'stub' or 'real'`);
}

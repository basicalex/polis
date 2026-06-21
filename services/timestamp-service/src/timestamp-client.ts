/**
 * @polis/timestamp-service — RFC 3161 timestamp seam (spec §9.14 + §15.6).
 *
 * The only M4 implementation is {@link StubTimestampClient}; a real adapter
 * (live RFC 3161 TSA endpoint) lands when a TSA is configured.
 * {@link createTimestampClient} is the single seam — TIMESTAMP_MODE=real
 * throws until that milestone so a misconfigured deploy fails fast rather
 * than silently falling back. Mirrors the M3 Paperless stub rule.
 *
 * §15.6: v0.1 timestamps hashes (not documents) and stores the token plus a
 * validation result. The stub mints a deterministic base64 token derived
 * from the hash + TSA id so `validate` can recompute and compare.
 */
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
 * Resolve the timestamp adapter from TIMESTAMP_MODE. Only 'stub' (default) is
 * supported in M4; any other value throws a clear error naming the milestone
 * that ships the real adapter.
 */
export function createTimestampClient(): TimestampClient {
  const mode = process.env.TIMESTAMP_MODE ?? 'stub';
  if (mode === 'stub') return new StubTimestampClient();
  throw new Error(
    `TIMESTAMP_MODE=${mode} is not supported in M4; lands when a real RFC 3161 TSA endpoint is configured`,
  );
}

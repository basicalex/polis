/**
 * @polis/polis-bridge-service Polis adapter contract (§13).
 *
 * The only M2 implementation is {@link StubPolisClient}; a real HTTP adapter
 * lands when a Polis instance is deployed. {@link createPolisClient} is the
 * single seam — POLIS_MODE=http throws until that milestone so a misconfigured
 * deploy fails fast rather than silently falling back. No HTTP client is
 * shipped in M2.
 */
import { createHash } from 'node:crypto';

export type ParticipationMode = 'open' | 'pseudonymous' | 'verified' | 'partner_restricted';

export type PolisConversationCreate = {
  issueId: string;
  title: string;
  framingQuestion: string;
  participationMode: ParticipationMode;
};

export type PolisReport = {
  consensusGroups: unknown;
  participantCount: number;
};

export type PolisCreateResult = { externalPolisId: string; reportUrl: string | null };

export interface PolisClient {
  createConversation(input: PolisConversationCreate): Promise<PolisCreateResult>;
  fetchReport(externalPolisId: string): Promise<PolisReport>;
}

/**
 * Deterministic stub used in M2 (and in tests). No network. The external id is
 * derived from the issue id + a timestamp so repeated creates are distinct; the
 * report payload is a canned consensus shape with a stable participant count
 * hashed from the external id.
 */
export class StubPolisClient implements PolisClient {
  async createConversation(input: PolisConversationCreate): Promise<PolisCreateResult> {
    const externalPolisId = `polis-stub-${input.issueId}-${Date.now().toString(36)}`;
    return { externalPolisId, reportUrl: null };
  }

  async fetchReport(externalPolisId: string): Promise<PolisReport> {
    const digest = createHash('sha256').update(externalPolisId).digest();
    const participantCount = 1 + (digest.readUInt32BE(0) % 200);
    return {
      consensusGroups: {
        clusters: [{ id: 'c1', label: 'Stub consensus cluster', n: participantCount }],
        consensus: ['Stub consensus statement'],
        disagreement: ['Stub disagreement axis'],
      },
      participantCount,
    };
  }
}

/**
 * Resolve the Polis adapter from POLIS_MODE. Only 'stub' (default) is supported
 * in M2; any other value throws a clear error naming the milestone that ships
 * the real adapter.
 */
export function createPolisClient(): PolisClient {
  const mode = process.env.POLIS_MODE ?? 'stub';
  if (mode === 'stub') return new StubPolisClient();
  throw new Error(
    `POLIS_MODE=${mode} is not supported in M2; lands when a Polis instance is deployed`,
  );
}

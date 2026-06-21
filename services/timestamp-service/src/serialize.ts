/**
 * Wire serializer for timestamp-service. DB rows are snake_case; this maps to
 * the §15.2 ProofTimestamp camelCase wire type so the public contract has one
 * home. Mirrors proof-service/src/serialize.ts.
 */
import type { ProofTimestamp } from '@polis/domain';
import type { schema } from '@polis/db';

type ProofTimestampRow = (typeof schema.proofTimestamps)['$inferSelect'];

export const proofTimestampWire = (r: ProofTimestampRow): ProofTimestamp => ({
  id: r.id,
  type: r.type as ProofTimestamp['type'],
  timestampRef: r.timestampRef,
  timestampedHash: r.timestampedHash,
  timestampedAt: r.timestampedAt.toISOString(),
  validationStatus: r.validationStatus as ProofTimestamp['validationStatus'],
  tsa: r.tsa,
  clockSource: r.clockSource,
});

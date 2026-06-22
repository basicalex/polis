/**
 * Wire serializer for contribution-service. DB rows are snake_case; this maps
 * to the §19 camelCase wire contract so the public shape has one home. Mirrors
 * proof-service/src/serialize.ts (services keep their own serializers —
 * cross-service src imports are not an established pattern).
 */
import type { schema } from '@polis/db';

type ContributorRow = (typeof schema.contributors)['$inferSelect'];
type SubmissionRow = (typeof schema.submissions)['$inferSelect'];
type GraphProposalRow = (typeof schema.graphProposals)['$inferSelect'];
type ReviewRow = (typeof schema.reviews)['$inferSelect'];

export const contributorWire = (r: ContributorRow) => ({
  id: r.id,
  identityLevel: r.identityLevel,
  displayName: r.displayName,
  createdAt: r.createdAt.toISOString(),
});

export const submissionWire = (r: SubmissionRow) => ({
  id: r.id,
  contributorId: r.contributorId,
  type: r.type,
  payload: r.payload,
  status: r.status,
  contributionClass: r.contributionClass,
  submittedAt: r.submittedAt.toISOString(),
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
});

export const graphProposalWire = (r: GraphProposalRow) => ({
  id: r.id,
  submissionId: r.submissionId,
  targetTable: r.targetTable,
  targetId: r.targetId,
  op: r.op,
  proposedPayload: r.proposedPayload,
  appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

export const reviewWire = (r: ReviewRow) => ({
  id: r.id,
  submissionId: r.submissionId,
  reviewerId: r.reviewerId,
  decision: r.decision,
  notes: r.notes,
  decidedAt: r.decidedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
});

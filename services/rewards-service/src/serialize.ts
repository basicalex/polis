/**
 * Wire serializer for rewards-service. DB rows are snake_case; this maps to the
 * §20.4 camelCase wire contract so the public shape has one home. Mirrors
 * contribution-service/src/serialize.ts (services keep their own serializers —
 * cross-service src imports are not an established pattern).
 *
 * `payoutWire` is INTERNAL ONLY — it is never returned by a public route
 * (acceptance: payout details private). It exists so the manual payout export
 * can build CSV from a typed row.
 */
import type { schema } from '@polis/db';

type EligibilityRow = (typeof schema.rewardEligibilityEvents)['$inferSelect'];
type PayoutRow = (typeof schema.rewardPayouts)['$inferSelect'];

export const eligibilityWire = (r: EligibilityRow) => ({
  id: r.id,
  submissionId: r.submissionId,
  contributorId: r.contributorId,
  contributionClass: r.contributionClass,
  period: r.period,
  amount: r.amount,
  outcome: r.outcome,
  denialReason: r.denialReason,
  createdAt: r.createdAt.toISOString(),
});

/** INTERNAL ONLY — never returned by a public route. */
export const payoutWire = (r: PayoutRow) => ({
  id: r.id,
  eligibilityId: r.eligibilityId,
  contributorId: r.contributorId,
  amount: r.amount,
  period: r.period,
  status: r.status,
  payoutRef: r.payoutRef,
  exportedAt: r.exportedAt ? r.exportedAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

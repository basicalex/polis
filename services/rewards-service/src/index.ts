/**
 * @polis/rewards-service — §20/§22/§30.8 rewards prototype (M7).
 *
 * Owns the reward_eligibility_events / reward_payouts tables. When a reviewer
 * approves a non-political contribution, contribution-service POSTs the
 * submission here; this service evaluates the reward policy (ADR-007: reward
 * effort, not outcome), applies the per-contributor monthly cap, records an
 * eligibility event, and creates a private pending payout for each eligible
 * event. A public aggregate ledger exposes funding by category/period with no
 * personal data; payout details are private and exportable as a manual payout
 * file (CSV) via an internal-only route.
 *
 * Identity is mock data for v0 (caller-supplied). The companion Rego policy
 * (packages/policy-rules/rewards/rewards.rego) is the authoritative decision
 * spec tested via opa eval; this service enforces equivalent checks in TS
 * (established M6 pattern).
 */
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

import { eligibilityWire } from './serialize.js';

/**
 * Prototype reward tunables (env-overridable). Operators override via env —
 * no code change. The acceptance reads the cap from /api/v1/rewards/rules.
 */
const REWARD_AMOUNT = process.env.REWARD_AMOUNT ?? '10'; // credits per eligible event
const REWARD_MONTHLY_CAP = Number(process.env.REWARD_MONTHLY_CAP ?? 5);

/** §22 rewardable contribution classes. political_agreement is never rewardable (ADR-007). */
const REWARDABLE_ACTIONS: Record<string, true> = {
  civic: true,
  evidence: true,
  graph_edit: true,
  claim: true,
};

/**
 * Best-effort audit emit. Failures (audit-service unreachable) are logged and
 * never fail the originating request — matches contribution-service.
 */
async function emitAudit(event: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetch(base + '/internal/audit/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: 'public',
        actor: { type: 'service', id: 'rewards-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'rewards-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Current UTC period ('YYYY-MM') — cap + ledger grouping granularity. */
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * RFC 4180 CSV field: quote when it contains a comma, quote, or newline; double
 * internal quotes. Used for the manual payout export.
 */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Build the §20/§22/§30.8 rewards route table bound to a DB client. */
export function rewardRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('rewards-service'),

    // §30.8 eligibility hook — contribution-service calls this on approve.
    // Idempotent on submission_id (unique index).
    {
      method: 'POST',
      path: '/internal/rewards/eligibility',
      handler: async (_req, body) => {
        const input = body as {
          submissionId?: string;
          contributorId?: string;
          contributionClass?: string;
        };
        if (
          !input.submissionId ||
          !input.contributorId ||
          !input.contributionClass ||
          !input.submissionId.trim() ||
          !input.contributorId.trim()
        ) {
          return result(400, { error: 'invalid_request' });
        }

        // Idempotency: re-evaluating an already-evaluated submission is a no-op.
        const existing = await db
          .select()
          .from(schema.rewardEligibilityEvents)
          .where(eq(schema.rewardEligibilityEvents.submissionId, input.submissionId))
          .limit(1);
        if (existing[0]) {
          return result(200, eligibilityWire(existing[0]));
        }

        const period = currentPeriod();
        // Defensive: contribution-service never calls for political, but the
        // service enforces ADR-007 itself. Political → denied (not rewardable).
        const rewardable = input.contributionClass in REWARDABLE_ACTIONS;

        // Anti-spam cap: count this contributor's eligible events this period.
        const capRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.rewardEligibilityEvents)
          .where(
            and(
              eq(schema.rewardEligibilityEvents.contributorId, input.contributorId),
              eq(schema.rewardEligibilityEvents.period, period),
              eq(schema.rewardEligibilityEvents.outcome, 'eligible'),
            ),
          );
        const periodTotal = Number(capRows[0]?.count ?? 0);

        let outcome: 'eligible' | 'denied';
        let amount: string;
        let denialReason: string | null;

        if (!rewardable) {
          // Political agreement is structurally not rewardable. Represented as
          // denied with a distinct reason (kept for the §20.5 appeal path).
          outcome = 'denied';
          amount = '0';
          denialReason = 'not_rewardable';
        } else if (periodTotal >= REWARD_MONTHLY_CAP) {
          outcome = 'denied';
          amount = '0';
          denialReason = 'monthly_cap_reached';
        } else {
          outcome = 'eligible';
          amount = REWARD_AMOUNT;
          denialReason = null;
        }

        const ins = await db
          .insert(schema.rewardEligibilityEvents)
          .values({
            id: sql`gen_random_uuid()::text`,
            submissionId: input.submissionId,
            contributorId: input.contributorId,
            contributionClass: input.contributionClass,
            period,
            amount,
            outcome,
            denialReason,
          })
          .onConflictDoNothing({ target: schema.rewardEligibilityEvents.submissionId })
          .returning();

        let eligibilityRow = ins[0];
        if (!eligibilityRow) {
          // Race lost: another worker inserted first. Re-read the winner.
          const reread = await db
            .select()
            .from(schema.rewardEligibilityEvents)
            .where(eq(schema.rewardEligibilityEvents.submissionId, input.submissionId))
            .limit(1);
          eligibilityRow = reread[0];
          if (!eligibilityRow) {
            // Should be unreachable given the unique index + onConflict.
            return result(500, { error: 'eligibility_not_persisted' });
          }
          return result(200, eligibilityWire(eligibilityRow));
        }

        // Create the private pending payout 1:1 with each eligible event.
        if (outcome === 'eligible') {
          await db.insert(schema.rewardPayouts).values({
            id: sql`gen_random_uuid()::text`,
            eligibilityId: eligibilityRow.id,
            contributorId: input.contributorId,
            amount,
            period,
            status: 'pending',
          });
        }

        await emitAudit({
          eventType: 'reward.eligibility.created',
          action: 'evaluate',
          target: { type: 'reward', id: eligibilityRow.id },
          data: {
            submissionId: input.submissionId,
            contributorId: input.contributorId,
            outcome,
            denialReason,
          },
        });

        return result(201, eligibilityWire(eligibilityRow));
      },
    },

    // §20.5 public reward rules (transparency). Static — no personal data.
    {
      method: 'GET',
      path: '/api/v1/rewards/rules',
      handler: async () => ({
        monthlyCap: REWARD_MONTHLY_CAP,
        amountPerEligibility: Number(REWARD_AMOUNT),
        unit: 'credits',
        politicalAgreementRewardable: false,
        rewardableActions: ['evidence', 'graph_edit', 'claim', 'civic'],
        forbiddenActions: ['political_agreement'],
        policy: 'ADR-007: reward effort, not outcome',
      }),
    },

    // §30.8 public aggregate ledger. No contributor data — privacy boundary is
    // structural (the query never selects personal columns).
    {
      method: 'GET',
      path: '/api/v1/rewards/public-ledger',
      handler: async () => {
        const rows = await db
          .select({
            period: schema.rewardEligibilityEvents.period,
            contributionClass: schema.rewardEligibilityEvents.contributionClass,
            count: sql<number>`count(*)::int`,
            totalAmount: sql<string>`SUM(amount)::text`,
          })
          .from(schema.rewardEligibilityEvents)
          .where(eq(schema.rewardEligibilityEvents.outcome, 'eligible'))
          .groupBy(
            schema.rewardEligibilityEvents.period,
            schema.rewardEligibilityEvents.contributionClass,
          )
          .orderBy(
            desc(schema.rewardEligibilityEvents.period),
            schema.rewardEligibilityEvents.contributionClass,
          );
        return {
          items: rows.map((r) => ({
            period: r.period,
            contributionClass: r.contributionClass,
            count: r.count,
            totalAmount: r.totalAmount,
          })),
        };
      },
    },

    // §30.8 internal eligibility lookup (acceptance + ops). Not proxied publicly.
    {
      method: 'GET',
      path: '/internal/rewards/eligibility/:submissionId',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.rewardEligibilityEvents)
          .where(eq(schema.rewardEligibilityEvents.submissionId, params.submissionId))
          .limit(1);
        if (!rows[0]) return result(404, { error: 'not_found' });
        return result(200, eligibilityWire(rows[0]));
      },
    },

    // §30.8 internal-only manual payout export (the "manual payout export"
    // deliverable). Selects pending payouts joined to contributors for payee
    // identity, builds CSV, marks them paid. NEVER proxied through the public
    // BFF — acceptance proves it is unreachable publicly.
    {
      method: 'GET',
      path: '/internal/rewards/payouts/export',
      handler: async () => {
        const payoutRef = 'payout-' + Date.now();
        const rows = await db
          .select({
            eligibilityId: schema.rewardPayouts.eligibilityId,
            contributorId: schema.rewardPayouts.contributorId,
            displayName: schema.contributors.displayName,
            amount: schema.rewardPayouts.amount,
            period: schema.rewardPayouts.period,
          })
          .from(schema.rewardPayouts)
          .innerJoin(
            schema.contributors,
            eq(schema.rewardPayouts.contributorId, schema.contributors.id),
          )
          .where(eq(schema.rewardPayouts.status, 'pending'))
          .orderBy(schema.rewardPayouts.createdAt);

        const lines = ['eligibility_id,contributor_id,display_name,amount,period'];
        for (const r of rows) {
          lines.push(
            [r.eligibilityId, r.contributorId, r.displayName, r.amount, r.period]
              .map((v) => csvField(String(v)))
              .join(','),
          );
        }
        const csv = lines.join('\n');

        const marked = await db
          .update(schema.rewardPayouts)
          .set({ status: 'paid', exportedAt: new Date(), payoutRef })
          .where(eq(schema.rewardPayouts.status, 'pending'))
          .returning({ id: schema.rewardPayouts.id });

        await emitAudit({
          eventType: 'reward.payout.exported',
          action: 'export',
          target: { type: 'reward_payout_batch', id: payoutRef },
          data: { count: marked.length, payoutRef },
        });

        return {
          csv,
          count: rows.length,
          markedPaid: marked.length,
          payoutRef,
        };
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8460);
  const db = getClient();
  startService('rewards-service', port, rewardRoutes(db));
  console.log(JSON.stringify({ service: 'rewards-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

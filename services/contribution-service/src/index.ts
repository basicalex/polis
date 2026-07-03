/**
 * @polis/contribution-service — §19/§21/§22 contribution + review v0 (M6).
 *
 * Owns the submissions / reviews / graph_proposals tables. Citizens submit
 * evidence or graph edits; reviewers approve/reject; approved (non-political)
 * submissions are applied to the shared governance graph (claims/sources) so
 * they become publicly readable via the existing GET /api/v1/claims route.
 * Every state change emits a best-effort audit event.
 *
 * Identity is mock data for v0 (identityLevel + reviewerRole are caller-
 * supplied). Real IAM-gated identity lands in M8. The companion Rego policy
 * (packages/policy-rules/contribute/access.rego) is the authoritative decision
 * spec tested via opa eval; this service enforces equivalent checks in TS.
 */
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import { contributorWire, graphProposalWire, questionWire, reviewWire, submissionWire } from './serialize.js';

/** §21 non-anonymous identity levels. */
const ALLOWED_IDENTITY: Record<string, true> = {
  casual: true,
  verified: true,
  enrolled: true,
  staff: true,
};
function identityOk(level: unknown): boolean {
  return typeof level === 'string' && level in ALLOWED_IDENTITY;
}

/** §19 claim-type allowlist (mirrors schema CLAIM_TYPES). */
const CLAIM_TYPES: Record<string, true> = {
  legal_mandate: true,
  budget_amount: true,
  role_responsibility: true,
  process_step: true,
  document_requirement: true,
  risk_assessment: true,
  proposal_assertion: true,
  public_statement: true,
  other: true,
};

/** v0 graph-edit target tables. */
const GRAPH_TARGET_TABLES: Record<string, true> = { claims: true, sources: true };
const GRAPH_OPS: Record<string, true> = { insert: true, update: true, delete: true };
/** §19 review decision inputs (action form); mapped to 'approved'/'rejected' state for storage. */
const DECISION_INPUTS: Record<string, true> = { approve: true, reject: true };
/** M-RA resolution statuses adjudicable via the filing route (status.rego terminal set). */
const RESOLUTION_STATUSES: Record<string, true> = {
  delivered: true,
  partial: true,
  not_delivered: true,
};

/** Return a trimmed non-empty string, or null for absent/non-string. */
function optionalNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

type SubmissionRow = (typeof schema.submissions)['$inferSelect'];

/**
 * Best-effort audit emit. Failures (audit-service unreachable) are logged and
 * never fail the originating request — matches proof-service + platform-api.
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
        actor: { type: 'service', id: 'contribution-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'contribution-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * Best-effort reward-eligibility emit. On approval of a non-political
 * contribution, POST the submission to rewards-service which evaluates the
 * §20.4 eligibility policy (ADR-007 + monthly cap). Failures (rewards-service
 * unreachable) are logged and never fail the originating approval — matches
 * emitAudit. Eligibility is reconciled by re-POSTing the submission to the
 * idempotent endpoint (dedupes on submission_id).
 */
async function emitRewardEligibility(input: {
  submissionId: string;
  contributorId: string;
  contributionClass: string;
}): Promise<void> {
  const base = process.env.REWARDS_INTERNAL_URL ?? 'http://localhost:8460';
  try {
    await fetch(base + '/internal/rewards/eligibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        submissionId: input.submissionId,
        contributorId: input.contributorId,
        contributionClass: input.contributionClass,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'contribution-service',
        stage: 'reward-eligibility-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * M-RA publish gate (Phase 2). TS-mirror of the authoritative
 * representative/access.rego: a mandate-holder may publish only when ALL three
 * hold — (1) their citizen identity is verified_official, (2) their
 * mandate_holder row is active, and (3) they hold an accepted charter.
 * Returns `null` when allowed, or the exact 403 result to return otherwise.
 */
async function assertCanPublish(
  db: DbClient,
  citizenId: string,
  mandateHolderId: string,
): Promise<null | HttpResult> {
  const citizenRows = await db
    .select({ identityLevel: schema.citizens.identityLevel })
    .from(schema.citizens)
    .where(eq(schema.citizens.id, citizenId))
    .limit(1);
  const citizen = citizenRows[0];
  if (!citizen || citizen.identityLevel !== 'verified_official') {
    return result(403, { error: 'not_verified_official' });
  }
  const holderRows = await db
    .select({ citizenId: schema.mandateHolders.citizenId, status: schema.mandateHolders.status })
    .from(schema.mandateHolders)
    .where(eq(schema.mandateHolders.id, mandateHolderId))
    .limit(1);
  const holder = holderRows[0];
  if (!holder || holder.citizenId !== citizenId) {
    return result(403, { error: 'not_mandate_holder' });
  }
  if (holder.status !== 'active') {
    return result(403, { error: 'mandate_inactive' });
  }
  const charterRows = await db
    .select({ status: schema.mandateHolderCharters.status })
    .from(schema.mandateHolderCharters)
    .where(eq(schema.mandateHolderCharters.mandateHolderId, mandateHolderId))
    .orderBy(desc(schema.mandateHolderCharters.updatedAt))
    .limit(1);
  const charter = charterRows[0];
  if (!charter || charter.status !== 'accepted') {
    return result(403, { error: 'charter_required' });
  }
  return null;
}
/**
 * Apply an approved (non-political) submission to the shared governance graph
 * so it is publicly readable. Returns whether the application succeeded; a
 * failure is logged + audited and never propagates (the review decision is
 * already recorded and must not be lost).
 */
async function applySubmission(db: DbClient, sub: SubmissionRow, reviewerId: string): Promise<boolean> {
  try {
    if (sub.type === 'evidence') {
      const p = (sub.payload ?? {}) as {
        text?: string;
        claimType?: string;
        subjectType?: string;
        subjectId?: string;
        confidence?: number;
      };
      await db.insert(schema.claims).values({
        id: sql`gen_random_uuid()::text`,
        text: p.text ?? '',
        claimType: p.claimType ?? 'other',
        subjectType: p.subjectType ?? 'unknown',
        subjectId: p.subjectId ?? 'unknown',
        confidence: String(p.confidence ?? 0.5),
        // Applied contribution claims are human-reviewed (reviewState approved)
        // but carry no formal source backing (no evidence_links), so the honest
        // confidence state is unsupported_draft — this also keeps the §23
        // governance integrity invariant (phase1) intact.
        confidenceState: 'unsupported_draft',
        reviewState: 'approved',
        visibility: 'public',
        methodVersion: 'contribution-m6',
      });
      await emitAudit({
        eventType: 'graph.edit.applied',
        action: 'apply',
        target: { type: 'contribution', id: sub.id },
        data: { appliedTo: 'claims' },
      });
      return true;
    }
    if (sub.type === 'graph_edit') {
      const propRows = await db
        .select()
        .from(schema.graphProposals)
        .where(eq(schema.graphProposals.submissionId, sub.id))
        .limit(1);
      const proposal = propRows[0];
      if (!proposal) return false;
      const payload = (proposal.proposedPayload ?? {}) as Record<string, unknown>;
      if (proposal.targetTable === 'claims') {
        await db.insert(schema.claims).values({
          id: sql`gen_random_uuid()::text`,
          text: String(payload.text ?? ''),
          claimType: String(payload.claimType ?? 'other'),
          subjectType: String(payload.subjectType ?? 'unknown'),
          subjectId: String(payload.subjectId ?? 'unknown'),
          confidence: String(payload.confidence ?? 0.5),
          confidenceState: 'unsupported_draft',
          reviewState: 'approved',
          visibility: 'public',
          methodVersion: 'contribution-m6',
        });
      } else if (proposal.targetTable === 'sources') {
        await db.insert(schema.sources).values({
          id: sql`gen_random_uuid()::text`,
          title: String(payload.title ?? 'Untitled'),
          url: typeof payload.url === 'string' ? payload.url : null,
          sourceType: typeof payload.sourceType === 'string' ? payload.sourceType : null,
          publisher: typeof payload.publisher === 'string' ? payload.publisher : null,
        });
      }
      await db
        .update(schema.graphProposals)
        .set({ appliedAt: new Date() })
        .where(eq(schema.graphProposals.id, proposal.id));
      await emitAudit({
        eventType: 'graph.edit.applied',
        action: 'apply',
        target: { type: 'graph-proposal', id: proposal.id },
        data: { targetTable: proposal.targetTable },
      });
      return true;
    }
    if (sub.type === 'claim' && sub.contributionClass === 'mandate_commitment') {
      const p = (sub.payload ?? {}) as {
        kind?: string;
        mandateHolderId?: string;
        claimId?: string;
        successCriterion?: string;
        dueAt?: string;
        processId?: string;
        jurisdictionId?: string;
        commitmentId?: string;
        status?: string;
        resolutionClaimId?: string;
      };
      if (p.kind === 'commitment') {
        await db.insert(schema.commitments).values({
          id: sql`gen_random_uuid()::text`,
          claimId: p.claimId ?? '',
          mandateHolderId: p.mandateHolderId ?? '',
          processId: p.processId ?? null,
          jurisdictionId: p.jurisdictionId ?? null,
          successCriterion: p.successCriterion ?? '',
          dueAt: p.dueAt ? new Date(p.dueAt) : null,
        });
        await emitAudit({
          eventType: 'mandate.commitment_applied',
          action: 'apply',
          target: { type: 'commitment', id: sub.id },
          data: { mandateHolderId: p.mandateHolderId },
        });
        return true;
      }
      if (p.kind === 'resolution') {
        await db.insert(schema.commitmentStatusEvents).values({
          id: sql`gen_random_uuid()::text`,
          commitmentId: p.commitmentId ?? '',
          status: p.status ?? 'delivered',
          resolutionClaimId: p.resolutionClaimId ?? null,
          decidedBy: reviewerId, // status.rego: completion is adjudicated, never self-declared
          decidedAt: new Date(),
        });
        await emitAudit({
          eventType: 'mandate.resolution_applied',
          action: 'apply',
          target: { type: 'commitment-status-event', id: sub.id },
          data: { commitmentId: p.commitmentId },
        });
        return true;
      }
    }
    if (sub.type === 'claim' && sub.contributionClass === 'mandate_answer') {
      const p = (sub.payload ?? {}) as {
        kind?: string;
        questionId?: string;
        mandateHolderId?: string;
        body?: string;
      };
      await db.insert(schema.commitmentAnswers).values({
        id: sql`gen_random_uuid()::text`,
        questionId: p.questionId ?? '',
        mandateHolderId: p.mandateHolderId ?? '',
        body: p.body ?? '',
        decidedBy: reviewerId, // answers are adjudicated, never self-declared
        decidedAt: new Date(),
      });
      await emitAudit({
        eventType: 'mandate.answer_applied',
        action: 'apply',
        target: { type: 'commitment-answer', id: sub.id },
        data: { questionId: p.questionId },
      });
      return true;
    }
    return false;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    console.error(
      JSON.stringify({ service: 'contribution-service', stage: 'apply', warning: reason }),
    );
    await emitAudit({
      eventType: 'contribution.apply_failed',
      action: 'apply_failed',
      target: { type: 'contribution', id: sub.id },
      data: { reason },
    });
    return false;
  }
}

/**
 * Resolve the contributor for a submit request. The identity gate must have
 * already passed (caller checks `identityOk` first). If `contributorId` is
 * given, load + validate it; else create a new contributor row.
 */
async function resolveContributor(
  db: DbClient,
  input: {
    contributor?: { displayName?: string; identityLevel?: string };
    contributorId?: string;
  },
): Promise<string | HttpResult> {
  if (input.contributorId) {
    const found = await db
      .select({ id: schema.contributors.id })
      .from(schema.contributors)
      .where(eq(schema.contributors.id, input.contributorId))
      .limit(1);
    if (!found[0]) {
      return result(404, { error: 'contributor_not_found', id: input.contributorId });
    }
    return input.contributorId;
  }
  const ins = await db
    .insert(schema.contributors)
    .values({
      id: sql`gen_random_uuid()::text`,
      identityLevel: input.contributor?.identityLevel ?? 'casual',
      displayName: input.contributor?.displayName ?? 'Anonymous',
    })
    .returning({ id: schema.contributors.id });
  return ins[0].id;
}

/** Build the §19 contribution + review route table bound to a DB client. */
export function contributionRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('contribution-service'),

    // §19 public evidence submission.
    {
      method: 'POST',
      path: '/api/v1/contribute/evidence',
      handler: async (_req, body) => {
        const input = body as {
          contributor?: { displayName?: string; identityLevel?: string };
          contributorId?: string;
          payload?: {
            text?: string;
            claimType?: string;
            subjectType?: string;
            subjectId?: string;
            confidence?: number;
            contributionClass?: string;
          };
        };
        if (!identityOk(input.contributor?.identityLevel)) {
          return result(403, { error: 'identity_required' });
        }
        const resolved = await resolveContributor(db, input);
        if (typeof resolved !== 'string') return resolved;
        const contributorId = resolved;
        const p = input.payload ?? {};
        const detail: string[] = [];
        if (!p.text || typeof p.text !== 'string') detail.push('text_required');
        if (!p.claimType || !(p.claimType in CLAIM_TYPES)) detail.push('invalid_claim_type');
        if (!p.subjectType) detail.push('subject_type_required');
        if (!p.subjectId) detail.push('subject_id_required');
        if (
          typeof p.confidence !== 'number' ||
          !Number.isFinite(p.confidence) ||
          p.confidence < 0 ||
          p.confidence > 1
        ) {
          detail.push('invalid_confidence');
        }
        if (detail.length) {
          return result(400, { error: 'invalid_evidence_payload', detail });
        }
        const evidence = {
          text: p.text,
          claimType: p.claimType,
          subjectType: p.subjectType,
          subjectId: p.subjectId,
          confidence: p.confidence,
          contributionClass: p.contributionClass ?? 'civic',
        };
        const ins = await db
          .insert(schema.submissions)
          .values({
            id: sql`gen_random_uuid()::text`,
            contributorId,
            type: 'evidence',
            status: 'pending',
            contributionClass: evidence.contributionClass,
            payload: evidence,
          })
          .returning();
        const row = ins[0];
        await emitAudit({
          eventType: 'contribution.submitted',
          action: 'submit',
          target: { type: 'contribution', id: row.id },
          data: { type: 'evidence', contributorId },
        });
        return result(201, submissionWire(row));
      },
    },

    // §19/§11 public graph-edit submission (insert-only in v0).
    {
      method: 'POST',
      path: '/api/v1/contribute/graph-edit',
      handler: async (_req, body) => {
        const input = body as {
          contributor?: { displayName?: string; identityLevel?: string };
          contributorId?: string;
          payload?: {
            targetTable?: string;
            targetId?: string;
            op?: string;
            proposedPayload?: unknown;
          };
        };
        if (!identityOk(input.contributor?.identityLevel)) {
          return result(403, { error: 'identity_required' });
        }
        const resolved = await resolveContributor(db, input);
        if (typeof resolved !== 'string') return resolved;
        const contributorId = resolved;
        const p = input.payload ?? {};
        if (!p.op || !(p.op in GRAPH_OPS)) return result(400, { error: 'invalid_op' });
        if (p.op !== 'insert') return result(400, { error: 'unsupported_op' });
        if (!p.targetTable || !(p.targetTable in GRAPH_TARGET_TABLES)) {
          return result(400, { error: 'unsupported_target_table' });
        }
        if (p.proposedPayload == null) {
          return result(400, { error: 'proposed_payload_required' });
        }
        const ins = await db
          .insert(schema.submissions)
          .values({
            id: sql`gen_random_uuid()::text`,
            contributorId,
            type: 'graph_edit',
            status: 'pending',
            payload: p,
          })
          .returning();
        const row = ins[0];
        const proposalIns = await db
          .insert(schema.graphProposals)
          .values({
            id: sql`gen_random_uuid()::text`,
            submissionId: row.id,
            targetTable: p.targetTable,
            targetId: p.targetId ?? null,
            op: p.op,
            proposedPayload: p.proposedPayload,
          })
          .returning();
        const proposal = proposalIns[0];
        await emitAudit({
          eventType: 'contribution.submitted',
          action: 'submit',
          target: { type: 'contribution', id: row.id },
          data: { type: 'graph_edit', targetTable: p.targetTable },
        });
        return result(201, { ...submissionWire(row), proposal: graphProposalWire(proposal) });
      },
    },

    // §19 submission detail with latest review + (if graph_edit) the proposal.
    {
      method: 'GET',
      path: '/api/v1/contributions/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.submissions)
          .where(eq(schema.submissions.id, params.id))
          .limit(1);
        const row = rows[0];
        if (!row) return result(404, { error: 'not_found', id: params.id });
        const reviewRows = await db
          .select()
          .from(schema.reviews)
          .where(eq(schema.reviews.submissionId, params.id))
          .orderBy(desc(schema.reviews.createdAt))
          .limit(1);
        const review = reviewRows[0] ? reviewWire(reviewRows[0]) : null;
        let proposal = null;
        if (row.type === 'graph_edit') {
          const propRows = await db
            .select()
            .from(schema.graphProposals)
            .where(eq(schema.graphProposals.submissionId, params.id))
            .limit(1);
          if (propRows[0]) proposal = graphProposalWire(propRows[0]);
        }
        return { ...submissionWire(row), review, proposal };
      },
    },

    // §21 contributor profile + their submissions (newest first).
    {
      method: 'GET',
      path: '/api/v1/contributors/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.contributors)
          .where(eq(schema.contributors.id, params.id))
          .limit(1);
        const row = rows[0];
        if (!row) return result(404, { error: 'not_found', id: params.id });
        const subs = await db
          .select()
          .from(schema.submissions)
          .where(eq(schema.submissions.contributorId, params.id))
          .orderBy(desc(schema.submissions.submittedAt));
        return { ...contributorWire(row), submissions: subs.map(submissionWire) };
      },
    },

    // §19 internal review queue — pending + in_review, oldest first.
    {
      method: 'GET',
      path: '/internal/review/queue',
      handler: async () => {
        const rows = await db
          .select()
          .from(schema.submissions)
          .where(inArray(schema.submissions.status, ['pending', 'in_review']))
          .orderBy(asc(schema.submissions.submittedAt));
        const items = await Promise.all(
          rows.map(async (s) => {
            const c = await db
              .select({ displayName: schema.contributors.displayName })
              .from(schema.contributors)
              .where(eq(schema.contributors.id, s.contributorId))
              .limit(1);
            return { ...submissionWire(s), contributorDisplayName: c[0]?.displayName ?? null };
          }),
        );
        return { items };
      },
    },

    // §19 reviewer decision. Append-only reviews; latest wins.
    {
      method: 'POST',
      path: '/internal/review/:id/decide',
      handler: async (_req, body, params) => {
        const input = body as {
          reviewerId?: string;
          reviewerRole?: string;
          decision?: string;
          notes?: string;
        };
        if (input.reviewerRole !== 'reviewer') {
          return result(403, { error: 'reviewer_role_required' });
        }
        if (!input.reviewerId) return result(400, { error: 'reviewer_id_required' });
        if (!input.decision || !(input.decision in DECISION_INPUTS)) {
          return result(400, { error: 'invalid_decision' });
        }
        const rows = await db
          .select()
          .from(schema.submissions)
          .where(eq(schema.submissions.id, params.id))
          .limit(1);
        const sub = rows[0];
        if (!sub) return result(404, { error: 'not_found', id: params.id });
        if (sub.status === 'approved' || sub.status === 'rejected') {
          return result(409, { error: 'already_decided' });
        }
        const decision = input.decision === 'approve' ? 'approved' : 'rejected';
        const reviewIns = await db
          .insert(schema.reviews)
          .values({
            id: sql`gen_random_uuid()::text`,
            submissionId: params.id,
            reviewerId: input.reviewerId,
            decision,
            notes: input.notes ?? null,
            decidedAt: new Date(),
          })
          .returning();
        const reviewRow = reviewIns[0];
        await db
          .update(schema.submissions)
          .set({ status: decision, decidedAt: new Date() })
          .where(eq(schema.submissions.id, params.id));
        let applied = false;
        if (decision === 'approved') {
          if (sub.contributionClass === 'political_agreement') {
            await emitAudit({
              eventType: 'contribution.held',
              action: 'hold',
              target: { type: 'contribution', id: params.id },
              data: { reason: 'political_agreement_not_auto_publishable' },
            });
          } else {
            applied = await applySubmission(db, sub, input.reviewerId);
          }
          await emitAudit({
            eventType: 'contribution.approved',
            action: 'approve',
            target: { type: 'contribution', id: params.id },
            data: { reviewerId: input.reviewerId, applied },
          });
          if (sub.contributionClass !== 'political_agreement' && sub.contributionClass !== 'mandate_commitment' && sub.contributionClass !== 'mandate_answer') {
            await emitRewardEligibility({
              submissionId: params.id,
              contributorId: sub.contributorId,
              contributionClass: sub.contributionClass,
            });
          }
        } else {
          await emitAudit({
            eventType: 'contribution.rejected',
            action: 'reject',
            target: { type: 'contribution', id: params.id },
            data: { reviewerId: input.reviewerId },
          });
        }
        const updated = await db
          .select()
          .from(schema.submissions)
          .where(eq(schema.submissions.id, params.id))
          .limit(1);
        return result(201, {
          ...submissionWire(updated[0]),
          review: reviewWire(reviewRow),
          applied,
        });
      },
    },

    // M-RA Phase 2 — file a commitment (mandate-holder authored, admin-reviewed).
    // Citizen identity rides X-Polis-Citizen (set by the BFF). The mandate-holder
    // citizen is stored as contributor_id: submissions.contributor_id is NOT NULL
    // with no FK to contributors (the §19 contributors table is a separate
    // contributor concept, not the mandate-holder author).
    {
      method: 'POST',
      path: '/internal/mandate-holders/:id/commitments',
      handler: async (req, body, params) => {
        const rawCitizen = req.headers['x-polis-citizen'];
        const citizenId = typeof rawCitizen === 'string' ? rawCitizen.trim() : '';
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const gate = await assertCanPublish(db, citizenId, params.id);
        if (gate) return gate;
        const p = (body ?? {}) as {
          claimId?: string;
          successCriterion?: string;
          dueAt?: string;
          processId?: string;
          jurisdictionId?: string;
        };
        const detail: string[] = [];
        const claimId = typeof p.claimId === 'string' ? p.claimId.trim() : '';
        const successCriterion =
          typeof p.successCriterion === 'string' ? p.successCriterion.trim() : '';
        if (!claimId) detail.push('claim_required');
        if (!successCriterion) detail.push('success_criterion_required');
        let dueAt: string | null = null;
        if (p.dueAt !== undefined && p.dueAt !== null) {
          if (
            typeof p.dueAt !== 'string' ||
            !p.dueAt.trim() ||
            Number.isNaN(Date.parse(p.dueAt))
          ) {
            detail.push('invalid_due_at');
          } else {
            dueAt = p.dueAt.trim();
          }
        }
        const processId = optionalNonEmpty(p.processId);
        if (p.processId !== undefined && p.processId !== null && processId === null) {
          detail.push('invalid_process_id');
        }
        const jurisdictionId = optionalNonEmpty(p.jurisdictionId);
        if (
          p.jurisdictionId !== undefined &&
          p.jurisdictionId !== null &&
          jurisdictionId === null
        ) {
          detail.push('invalid_jurisdiction_id');
        }
        if (detail.length) {
          return result(400, { error: 'invalid_commitment_payload', detail });
        }
        const payload = {
          kind: 'commitment',
          mandateHolderId: params.id,
          claimId,
          successCriterion,
          dueAt,
          processId,
          jurisdictionId,
        };
        const ins = await db
          .insert(schema.submissions)
          .values({
            id: sql`gen_random_uuid()::text`,
            contributorId: citizenId,
            type: 'claim',
            status: 'pending',
            contributionClass: 'mandate_commitment',
            payload,
          })
          .returning();
        const row = ins[0];
        await emitAudit({
          eventType: 'mandate.commitment_filed',
          action: 'submit',
          target: { type: 'contribution', id: row.id },
          data: { mandateHolderId: params.id, claimId },
        });
        return result(201, submissionWire(row));
      },
    },
    // M-RA Phase 2 — file a resolution (terminal status adjudication) for an
    // existing commitment. The filing citizen must own the commitment's mandate
    // (assertCanPublish); the terminal status is adjudicated by admin review
    // (status.rego) and recorded with the reviewer's id, never self-declared.
    {
      method: 'POST',
      path: '/internal/commitments/:id/resolutions',
      handler: async (req, body, params) => {
        const rawCitizen = req.headers['x-polis-citizen'];
        const citizenId = typeof rawCitizen === 'string' ? rawCitizen.trim() : '';
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const cRows = await db
          .select({ mandateHolderId: schema.commitments.mandateHolderId })
          .from(schema.commitments)
          .where(eq(schema.commitments.id, params.id))
          .limit(1);
        const commitment = cRows[0];
        if (!commitment) return result(404, { error: 'not_found', id: params.id });
        const gate = await assertCanPublish(db, citizenId, commitment.mandateHolderId);
        if (gate) return gate;
        const p = (body ?? {}) as { status?: string; resolutionClaimId?: string };
        if (!p.status || !(p.status in RESOLUTION_STATUSES)) {
          return result(400, { error: 'invalid_resolution_status' });
        }
        const resolutionClaimId = optionalNonEmpty(p.resolutionClaimId);
        if (
          p.resolutionClaimId !== undefined &&
          p.resolutionClaimId !== null &&
          resolutionClaimId === null
        ) {
          return result(400, { error: 'invalid_resolution_claim_id' });
        }
        const payload = {
          kind: 'resolution',
          commitmentId: params.id,
          status: p.status,
          resolutionClaimId,
        };
        const ins = await db
          .insert(schema.submissions)
          .values({
            id: sql`gen_random_uuid()::text`,
            contributorId: citizenId,
            type: 'claim',
            status: 'pending',
            contributionClass: 'mandate_commitment',
            payload,
          })
          .returning();
        const row = ins[0];
        await emitAudit({
          eventType: 'mandate.resolution_filed',
          action: 'submit',
          target: { type: 'contribution', id: row.id },
          data: { commitmentId: params.id, status: p.status },
        });
        return result(201, submissionWire(row));
      },
    },
    // M-RA Phase 3 — citizen ask on a commitment. Auto-published (a prompt, not
    // a claim): any authenticated citizen may ask; no review adjudication.
    {
      method: 'POST',
      path: '/internal/commitments/:id/questions',
      handler: async (req, body, params) => {
        const rawCitizen = req.headers['x-polis-citizen'];
        const citizenId = typeof rawCitizen === 'string' ? rawCitizen.trim() : '';
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const cRows = await db
          .select({ id: schema.commitments.id })
          .from(schema.commitments)
          .where(eq(schema.commitments.id, params.id))
          .limit(1);
        if (!cRows[0]) return result(404, { error: 'not_found', id: params.id });
        const q = (body ?? {}) as { body?: string };
        const text = typeof q.body === 'string' ? q.body.trim() : '';
        if (!text) return result(400, { error: 'invalid_question_payload', detail: ['body_required'] });
        const ins = await db
          .insert(schema.commitmentQuestions)
          .values({
            id: sql`gen_random_uuid()::text`,
            commitmentId: params.id,
            askedByCitizenId: citizenId,
            body: text,
          })
          .returning();
        const row = ins[0];
        await emitAudit({
          eventType: 'mandate.question_asked',
          action: 'submit',
          target: { type: 'commitment-question', id: row.id },
          data: { commitmentId: params.id },
        });
        return result(201, questionWire(row));
      },
    },
    // M-RA Phase 3 — official answer to a question. Mandate-gated (only the
    // commitment's mandate owner may answer) and admin-adjudicated: the answer
    // is filed as a 'mandate_answer' submission and applied on approval
    // (mirrors the Phase 2 resolution path).
    {
      method: 'POST',
      path: '/internal/commitment-questions/:id/answers',
      handler: async (req, body, params) => {
        const rawCitizen = req.headers['x-polis-citizen'];
        const citizenId = typeof rawCitizen === 'string' ? rawCitizen.trim() : '';
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const qRows = await db
          .select({ commitmentId: schema.commitmentQuestions.commitmentId })
          .from(schema.commitmentQuestions)
          .where(eq(schema.commitmentQuestions.id, params.id))
          .limit(1);
        const question = qRows[0];
        if (!question) return result(404, { error: 'not_found', id: params.id });
        const cRows = await db
          .select({ mandateHolderId: schema.commitments.mandateHolderId })
          .from(schema.commitments)
          .where(eq(schema.commitments.id, question.commitmentId))
          .limit(1);
        const commitment = cRows[0];
        if (!commitment) return result(404, { error: 'not_found', id: question.commitmentId });
        const gate = await assertCanPublish(db, citizenId, commitment.mandateHolderId);
        if (gate) return gate;
        const input = (body ?? {}) as { body?: string };
        const answerText = typeof input.body === 'string' ? input.body.trim() : '';
        if (!answerText) return result(400, { error: 'invalid_answer_payload', detail: ['body_required'] });
        const payload = {
          kind: 'answer',
          questionId: params.id,
          mandateHolderId: commitment.mandateHolderId,
          body: answerText,
        };
        const ins = await db
          .insert(schema.submissions)
          .values({
            id: sql`gen_random_uuid()::text`,
            contributorId: citizenId,
            type: 'claim',
            status: 'pending',
            contributionClass: 'mandate_answer',
            payload,
          })
          .returning();
        const row = ins[0];
        await emitAudit({
          eventType: 'mandate.answer_filed',
          action: 'submit',
          target: { type: 'contribution', id: row.id },
          data: { questionId: params.id },
        });
        return result(201, submissionWire(row));
      },
    },
    // §11 graph-proposal staging view for the admin UI.
    {
      method: 'GET',
      path: '/internal/contributions/graph-proposals',
      handler: async () => {
        const props = await db
          .select()
          .from(schema.graphProposals)
          .orderBy(desc(schema.graphProposals.createdAt));
        const items = await Promise.all(
          props.map(async (pr) => {
            const subs = await db
              .select({ status: schema.submissions.status })
              .from(schema.submissions)
              .where(eq(schema.submissions.id, pr.submissionId))
              .limit(1);
            return {
              ...graphProposalWire(pr),
              submissionStatus: subs[0]?.status ?? null,
            };
          }),
        );
        return { items };
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8450);
  const db = getClient();
  startService('contribution-service', port, contributionRoutes(db));
  console.log(JSON.stringify({ service: 'contribution-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

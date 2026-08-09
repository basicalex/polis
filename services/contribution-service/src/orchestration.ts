import { randomUUID } from 'node:crypto';
import { schema, type DbClient } from '@polis/db';
import { and, eq } from 'drizzle-orm';
import { emitAudit, emitRewardEligibility, requiredAudit } from './audit.js';
import { hasReviewAuthority, type TrustedContributionActor } from './authorization.js';
import { applySubmission, ensureContributor } from './repository.js';
import type { AuditEvent, SubmissionRow } from './types.js';

export type EvidenceSubmission = {
  text: string;
  claimType: string;
  subjectType: string;
  subjectId: string;
  confidence: number;
  contributionClass: string;
};

export async function submitEvidence(
  db: DbClient,
  actor: TrustedContributionActor,
  evidence: EvidenceSubmission,
): Promise<SubmissionRow> {
  const submissionId = randomUUID();
  await requiredAudit({
    eventType: 'contribution.submission_authorized',
    action: 'submit_authorized',
    actor: { type: 'user', id: actor.citizenId },
    target: { type: 'contribution', id: submissionId },
    data: { type: 'evidence' },
  });
  return db.transaction(async (tx) => {
    await ensureContributor(tx, actor);
    const insertedRows = await tx
      .insert(schema.submissions)
      .values({
        id: submissionId,
        contributorId: actor.citizenId,
        type: 'evidence',
        status: 'pending',
        contributionClass: evidence.contributionClass,
        payload: evidence,
      })
      .returning();
    const inserted = insertedRows[0];
    await requiredAudit({
      eventType: 'contribution.submitted',
      action: 'submit',
      actor: { type: 'user', id: actor.citizenId },
      target: { type: 'contribution', id: inserted.id },
      data: { type: 'evidence', contributorId: actor.citizenId },
    });
    return inserted;
  });
}

export type GraphEditSubmission = {
  targetTable: string;
  targetId: string | null;
  op: string;
  proposedPayload: unknown;
};

export async function submitGraphEdit(
  db: DbClient,
  actor: TrustedContributionActor,
  graphEdit: GraphEditSubmission,
) {
  const submissionId = randomUUID();
  await requiredAudit({
    eventType: 'contribution.submission_authorized',
    action: 'submit_authorized',
    actor: { type: 'user', id: actor.citizenId },
    target: { type: 'contribution', id: submissionId },
    data: { type: 'graph_edit', targetTable: graphEdit.targetTable },
  });
  return db.transaction(async (tx) => {
    await ensureContributor(tx, actor);
    const insertedRows = await tx
      .insert(schema.submissions)
      .values({
        id: submissionId,
        contributorId: actor.citizenId,
        type: 'graph_edit',
        status: 'pending',
        payload: graphEdit,
      })
      .returning();
    const row = insertedRows[0];
    const proposalRows = await tx
      .insert(schema.graphProposals)
      .values({
        id: randomUUID(),
        submissionId: row.id,
        targetTable: graphEdit.targetTable,
        targetId: graphEdit.targetId,
        op: graphEdit.op,
        proposedPayload: graphEdit.proposedPayload,
      })
      .returning();
    const proposal = proposalRows[0];
    await requiredAudit({
      eventType: 'contribution.submitted',
      action: 'submit',
      actor: { type: 'user', id: actor.citizenId },
      target: { type: 'contribution', id: row.id },
      data: {
        type: 'graph_edit',
        targetTable: graphEdit.targetTable,
        proposalId: proposal.id,
      },
    });
    return { row, proposal };
  });
}

export type ReviewDecisionErrorCode =
  'already_decided' | 'review_authority_required' | 'self_review_forbidden';

export class ReviewDecisionError extends Error {
  constructor(readonly code: ReviewDecisionErrorCode) {
    super(code);
    this.name = 'ReviewDecisionError';
  }
}

export async function decideSubmission(input: {
  db: DbClient;
  actor: TrustedContributionActor;
  submission: SubmissionRow;
  decision: 'approved' | 'rejected';
  notes?: string;
}) {
  const { db, actor, submission, decision } = input;
  const deferredAudits: AuditEvent[] = [];
  const mutation = await db.transaction(async (tx) => {
    if (!(await hasReviewAuthority(tx, actor))) {
      throw new ReviewDecisionError('review_authority_required');
    }
    const claimedRows = await tx
      .update(schema.submissions)
      .set({ status: 'in_review' })
      .where(
        and(eq(schema.submissions.id, submission.id), eq(schema.submissions.status, 'pending')),
      )
      .returning();
    const claimed = claimedRows[0];
    if (!claimed) throw new ReviewDecisionError('already_decided');
    if (claimed.contributorId === actor.citizenId) {
      throw new ReviewDecisionError('self_review_forbidden');
    }
    await requiredAudit({
      eventType: 'contribution.review_authorized',
      action: 'review_authorized',
      actor: { type: 'user', id: actor.citizenId },
      target: { type: 'contribution', id: claimed.id },
      data: { decision },
    });
    const reviewRows = await tx
      .insert(schema.reviews)
      .values({
        id: randomUUID(),
        submissionId: claimed.id,
        reviewerId: actor.citizenId,
        decision,
        notes: input.notes ?? null,
        decidedAt: new Date(),
      })
      .returning();
    const reviewRow = reviewRows[0];
    let applied = false;
    if (decision === 'approved') {
      if (claimed.contributionClass === 'political_agreement') {
        deferredAudits.push({
          eventType: 'contribution.held',
          action: 'hold',
          visibility: 'restricted',
          actor: { type: 'user', id: actor.citizenId },
          target: { type: 'contribution', id: claimed.id },
          data: { reason: 'political_agreement_not_auto_publishable' },
        });
      } else {
        applied = await applySubmission(tx, claimed, actor.citizenId, deferredAudits);
      }
    }
    const updatedRows = await tx
      .update(schema.submissions)
      .set({ status: decision, decidedAt: new Date() })
      .where(and(eq(schema.submissions.id, claimed.id), eq(schema.submissions.status, 'in_review')))
      .returning();
    const updated = updatedRows[0];
    if (!updated) throw new ReviewDecisionError('already_decided');
    await requiredAudit({
      eventType: decision === 'approved' ? 'contribution.approved' : 'contribution.rejected',
      action: decision === 'approved' ? 'approve' : 'reject',
      actor: { type: 'user', id: actor.citizenId },
      target: { type: 'contribution', id: claimed.id },
      data: { decision, applied },
    });
    return { updated, reviewRow, applied, claimed };
  });
  for (const event of deferredAudits) await emitAudit(event);
  if (
    decision === 'approved' &&
    mutation.claimed.contributionClass !== 'political_agreement' &&
    mutation.claimed.contributionClass !== 'mandate_commitment' &&
    mutation.claimed.contributionClass !== 'mandate_answer'
  ) {
    await emitRewardEligibility({
      submissionId: mutation.claimed.id,
      contributorId: mutation.claimed.contributorId,
      contributionClass: mutation.claimed.contributionClass,
    });
  }
  return mutation;
}

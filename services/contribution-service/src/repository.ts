import { schema, type DbClient } from '@polis/db';
import { eq, sql } from 'drizzle-orm';
import { storedContributorIdentity, type TrustedContributionActor } from './authorization.js';
import type { AuditEvent, MutationDb, SubmissionRow } from './types.js';

type RepresentativeEvidenceInput = {
  sourceId?: string;
  locator?: unknown;
  quote?: string;
  paraphrase?: string;
  sourceHash?: string;
  retrievedAt?: string;
  confidence?: number | string;
  visibility?: string;
};

function optionalNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function representativeEvidenceItems(value: unknown): RepresentativeEvidenceInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RepresentativeEvidenceInput => item !== null && typeof item === 'object',
  );
}

function representativeEvidenceVisibility(
  visibility: unknown,
): 'public' | 'restricted' | 'private' {
  return visibility === 'public' || visibility === 'restricted' || visibility === 'private'
    ? visibility
    : 'restricted';
}

export async function persistRepresentativeEvidence(input: {
  db: Pick<DbClient, 'insert'>;
  evidence: unknown;
  claimId: string;
}): Promise<{ evidenceCount: number; redactionRelevant: boolean }> {
  const items = representativeEvidenceItems(input.evidence);
  if (!items.length) return { evidenceCount: 0, redactionRelevant: false };
  let redactionRelevant = false;
  await input.db.insert(schema.evidenceLinks).values(
    items.map((item, index) => {
      const visibility = representativeEvidenceVisibility(item.visibility);
      redactionRelevant ||= visibility !== 'public';
      return {
        id: sql`gen_random_uuid()::text`,
        claimId: input.claimId,
        sourceId: optionalNonEmpty(item.sourceId) ?? `representative:${input.claimId}:${index}`,
        locator: item.locator ?? null,
        quote: typeof item.quote === 'string' ? item.quote : null,
        paraphrase: typeof item.paraphrase === 'string' ? item.paraphrase : null,
        sourceHash: typeof item.sourceHash === 'string' ? item.sourceHash : null,
        retrievedAt:
          typeof item.retrievedAt === 'string' && !Number.isNaN(Date.parse(item.retrievedAt))
            ? new Date(item.retrievedAt)
            : null,
        confidence: String(item.confidence ?? 0.5),
        visibility,
      };
    }),
  );
  return { evidenceCount: items.length, redactionRelevant };
}

/**
 * Apply an approved (non-political) submission to the shared governance graph
 * within the caller's transaction. Database failures propagate so no review
 * decision can commit without its corresponding application mutations.
 */
export async function applySubmission(
  db: MutationDb,
  sub: SubmissionRow,
  reviewerId: string,
  deferredAudits: AuditEvent[],
): Promise<boolean> {
  if (sub.type === 'evidence') {
    const payload = (sub.payload ?? {}) as {
      text?: string;
      claimType?: string;
      subjectType?: string;
      subjectId?: string;
      confidence?: number;
    };
    await db.insert(schema.claims).values({
      id: sql`gen_random_uuid()::text`,
      text: payload.text ?? '',
      claimType: payload.claimType ?? 'other',
      subjectType: payload.subjectType ?? 'unknown',
      subjectId: payload.subjectId ?? 'unknown',
      confidence: String(payload.confidence ?? 0.5),
      confidenceState: 'unsupported_draft',
      reviewState: 'approved',
      visibility: 'public',
      methodVersion: 'contribution-m6',
    });
    deferredAudits.push({
      eventType: 'graph.edit.applied',
      action: 'apply',
      target: { type: 'contribution', id: sub.id },
      data: { appliedTo: 'claims' },
    });
    return true;
  }
  if (sub.type === 'graph_edit') {
    const proposalRows = await db
      .select()
      .from(schema.graphProposals)
      .where(eq(schema.graphProposals.submissionId, sub.id))
      .limit(1);
    const proposal = proposalRows[0];
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
    deferredAudits.push({
      eventType: 'graph.edit.applied',
      action: 'apply',
      target: { type: 'graph-proposal', id: proposal.id },
      data: { targetTable: proposal.targetTable },
    });
    return true;
  }
  if (sub.type === 'claim' && sub.contributionClass === 'mandate_commitment') {
    const payload = (sub.payload ?? {}) as {
      kind?: string;
      commitmentId?: string;
      status?: string;
      resolutionClaimId?: string;
    };
    if (
      payload.kind === 'resolution' &&
      (!payload.status || !(payload.status in RESOLUTION_STATUSES) || !payload.resolutionClaimId)
    ) {
      return false;
    }
    if (payload.kind === 'resolution') {
      const resolutionClaimId = payload.resolutionClaimId ?? '';
      await db
        .update(schema.claims)
        .set({ reviewState: 'approved' })
        .where(eq(schema.claims.id, resolutionClaimId));
      const statusEventRows = await db
        .insert(schema.commitmentStatusEvents)
        .values({
          id: sql`gen_random_uuid()::text`,
          commitmentId: payload.commitmentId ?? '',
          status: payload.status ?? 'delivered',
          resolutionClaimId,
          decidedBy: reviewerId,
          decidedAt: new Date(),
        })
        .returning({ id: schema.commitmentStatusEvents.id });
      const statusEvent = statusEventRows[0];
      deferredAudits.push({
        eventType: 'representative.commitment.status_changed',
        action: 'status_changed',
        target: { type: 'commitment-status-event', id: statusEvent.id },
        data: {
          commitmentId: payload.commitmentId,
          status: payload.status,
          resolutionClaimId,
        },
      });
      return true;
    }
  }
  if (sub.type === 'claim' && sub.contributionClass === 'mandate_answer') {
    const payload = (sub.payload ?? {}) as {
      kind?: string;
      questionId?: string;
      mandateHolderId?: string;
      body?: string;
    };
    await db.insert(schema.commitmentAnswers).values({
      id: sql`gen_random_uuid()::text`,
      questionId: payload.questionId ?? '',
      mandateHolderId: payload.mandateHolderId ?? '',
      body: payload.body ?? '',
      decidedBy: reviewerId,
      decidedAt: new Date(),
    });
    deferredAudits.push({
      eventType: 'mandate.answer_applied',
      action: 'apply',
      target: { type: 'commitment-answer', id: sub.id },
      data: { questionId: payload.questionId },
    });
    return true;
  }
  return false;
}

const RESOLUTION_STATUSES: Record<string, true> = {
  delivered: true,
  partial: true,
  not_delivered: true,
};

export async function ensureContributor(
  db: MutationDb,
  actor: TrustedContributionActor,
): Promise<void> {
  const found = await db
    .select({ id: schema.contributors.id })
    .from(schema.contributors)
    .where(eq(schema.contributors.id, actor.citizenId))
    .limit(1);
  if (found[0]) return;
  await db
    .insert(schema.contributors)
    .values({
      id: actor.citizenId,
      identityLevel: storedContributorIdentity(actor.identityLevel),
      displayName: actor.citizenId,
    })
    .returning({ id: schema.contributors.id });
}

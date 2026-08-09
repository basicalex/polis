import { schema, type DbClient } from '@polis/db';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { result, type Route } from '@polis/service-runtime';
import { AuditUnavailableError } from './audit.js';
import {
  hasAuthorityFields,
  hasReviewAuthority,
  isTrustedContributionActor,
  trustedContributionActor,
} from './authorization.js';
import {
  decideSubmission,
  ReviewDecisionError,
  submitEvidence,
  submitGraphEdit,
} from './orchestration.js';
import { contributorWire, graphProposalWire, reviewWire, submissionWire } from './serialize.js';

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
const GRAPH_TARGET_TABLES: Record<string, true> = { claims: true, sources: true };
const GRAPH_OPS: Record<string, true> = { insert: true, update: true, delete: true };
const DECISION_INPUTS: Record<string, true> = { approve: true, reject: true };

export function contributionApiRoutes(db: DbClient): Route[] {
  return [
    {
      method: 'POST',
      path: '/api/v1/contribute/evidence',
      handler: async (req, body) => {
        if (hasAuthorityFields(body, ['contributor', 'contributorId'])) {
          return result(400, { error: 'authority_fields_forbidden' });
        }
        const actor = trustedContributionActor(req);
        if (!isTrustedContributionActor(actor)) return actor;
        const input = body as {
          payload?: {
            text?: string;
            claimType?: string;
            subjectType?: string;
            subjectId?: string;
            confidence?: number;
            contributionClass?: string;
          };
        };
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
          text: p.text as string,
          claimType: p.claimType as string,
          subjectType: p.subjectType as string,
          subjectId: p.subjectId as string,
          confidence: p.confidence as number,
          contributionClass: p.contributionClass ?? 'civic',
        };
        try {
          const row = await submitEvidence(db, actor, evidence);
          return result(201, submissionWire(row));
        } catch (error) {
          if (error instanceof AuditUnavailableError) {
            return result(503, { error: 'audit_unavailable' });
          }
          throw error;
        }
      },
    },
    {
      method: 'POST',
      path: '/api/v1/contribute/graph-edit',
      handler: async (req, body) => {
        if (hasAuthorityFields(body, ['contributor', 'contributorId'])) {
          return result(400, { error: 'authority_fields_forbidden' });
        }
        const actor = trustedContributionActor(req);
        if (!isTrustedContributionActor(actor)) return actor;
        const input = body as {
          payload?: {
            targetTable?: string;
            targetId?: string;
            op?: string;
            proposedPayload?: unknown;
          };
        };
        const p = input.payload ?? {};
        if (!p.op || !(p.op in GRAPH_OPS)) return result(400, { error: 'invalid_op' });
        if (p.op !== 'insert') return result(400, { error: 'unsupported_op' });
        if (!p.targetTable || !(p.targetTable in GRAPH_TARGET_TABLES)) {
          return result(400, { error: 'unsupported_target_table' });
        }
        if (p.proposedPayload == null) {
          return result(400, { error: 'proposed_payload_required' });
        }
        const graphEdit = {
          targetTable: p.targetTable,
          targetId: p.targetId ?? null,
          op: p.op,
          proposedPayload: p.proposedPayload,
        };
        try {
          const mutation = await submitGraphEdit(db, actor, graphEdit);
          return result(201, {
            ...submissionWire(mutation.row),
            proposal: graphProposalWire(mutation.proposal),
          });
        } catch (error) {
          if (error instanceof AuditUnavailableError) {
            return result(503, { error: 'audit_unavailable' });
          }
          throw error;
        }
      },
    },
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
    {
      method: 'GET',
      path: '/internal/review/queue',
      handler: async (req) => {
        const actor = trustedContributionActor(req);
        if (!isTrustedContributionActor(actor)) return actor;
        if (actor.identityLevel !== 'staff') {
          return result(403, { error: 'staff_required' });
        }
        if (!(await hasReviewAuthority(db, actor))) {
          return result(403, { error: 'review_authority_required' });
        }
        const rows = await db
          .select()
          .from(schema.submissions)
          .where(inArray(schema.submissions.status, ['pending', 'in_review']))
          .orderBy(asc(schema.submissions.submittedAt));
        const items = await Promise.all(
          rows.map(async (submission) => {
            const contributors = await db
              .select({ displayName: schema.contributors.displayName })
              .from(schema.contributors)
              .where(eq(schema.contributors.id, submission.contributorId))
              .limit(1);
            return {
              ...submissionWire(submission),
              contributorDisplayName: contributors[0]?.displayName ?? null,
            };
          }),
        );
        return { items };
      },
    },
    {
      method: 'POST',
      path: '/internal/review/:id/decide',
      handler: async (req, body, params) => {
        if (hasAuthorityFields(body, ['reviewerId', 'reviewerRole'])) {
          return result(400, { error: 'authority_fields_forbidden' });
        }
        const actor = trustedContributionActor(req);
        if (!isTrustedContributionActor(actor)) return actor;
        if (actor.identityLevel !== 'staff') {
          return result(403, { error: 'staff_required' });
        }
        if (!(await hasReviewAuthority(db, actor))) {
          return result(403, { error: 'review_authority_required' });
        }
        const input = body as { decision?: string; notes?: string };
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
        if (sub.contributorId === actor.citizenId) {
          return result(403, { error: 'self_review_forbidden' });
        }
        const decision = input.decision === 'approve' ? 'approved' : 'rejected';
        try {
          const mutation = await decideSubmission({
            db,
            actor,
            submission: sub,
            decision,
            notes: input.notes,
          });
          return result(201, {
            ...submissionWire(mutation.updated),
            review: reviewWire(mutation.reviewRow),
            applied: mutation.applied,
          });
        } catch (error) {
          if (error instanceof AuditUnavailableError) {
            return result(503, { error: 'audit_unavailable' });
          }
          if (error instanceof ReviewDecisionError) {
            if (error.code === 'already_decided') {
              return result(409, { error: 'already_decided' });
            }
            if (error.code === 'self_review_forbidden') {
              return result(403, { error: 'self_review_forbidden' });
            }
            return result(403, { error: 'review_authority_required' });
          }
          throw error;
        }
      },
    },
  ];
}

export function graphProposalRoutes(db: DbClient): Route[] {
  return [
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

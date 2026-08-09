import { schema, type DbClient } from '@polis/db';
import { eq, sql } from 'drizzle-orm';
import { result, type Route } from '@polis/service-runtime';
import {
  AuditUnavailableError,
  emitAudit,
  emitRepresentativeDeniedAudit,
  requiredAudit,
} from './audit.js';
import { persistRepresentativeEvidence } from './repository.js';
import {
  assertCanPublish,
  type PublishDenial,
  type RequestedCommitmentScope,
} from './representative-publish-gate.js';
import { questionWire, submissionWire } from './serialize.js';

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
const RESOLUTION_STATUSES: Record<string, true> = {
  delivered: true,
  partial: true,
  not_delivered: true,
};
const NON_TERMINAL_COMMITMENT_STATUSES: Record<string, true> = {
  proposed: true,
  in_progress: true,
};

function optionalNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

class RepresentativeAuthorizationDeniedError extends Error {
  constructor(
    readonly denial: PublishDenial,
    readonly mandateHolderId: string,
    readonly requestedScope: RequestedCommitmentScope,
  ) {
    super(denial.error);
    this.name = 'RepresentativeAuthorizationDeniedError';
  }
}

class RepresentativeNotFoundError extends Error {
  constructor(readonly body: { error: string; id: string }) {
    super(body.error);
    this.name = 'RepresentativeNotFoundError';
  }
}

export function representativeRoutes(db: DbClient): Route[] {
  return [
    {
      method: 'POST',
      path: '/internal/mandate-holders/:id/commitments',
      handler: async (req, body, params) => {
        const rawCitizen = req.headers['x-polis-citizen'];
        const citizenId = typeof rawCitizen === 'string' ? rawCitizen.trim() : '';
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const p = (body ?? {}) as {
          text?: string;
          claimType?: string;
          claimId?: string;
          successCriterion?: string;
          dueAt?: string;
          processId?: string;
          jurisdictionId?: string;
          evidence?: unknown;
          status?: string;
        };
        const detail: string[] = [];
        if (p.status && p.status in RESOLUTION_STATUSES) {
          detail.push('terminal_status_not_allowed');
        }
        const claimIdInput = typeof p.claimId === 'string' ? p.claimId.trim() : '';
        const text = typeof p.text === 'string' ? p.text.trim() : '';
        const claimType =
          typeof p.claimType === 'string' && p.claimType in CLAIM_TYPES
            ? p.claimType
            : 'proposal_assertion';
        const successCriterion =
          typeof p.successCriterion === 'string' ? p.successCriterion.trim() : '';
        if (!claimIdInput && !text) detail.push('claim_text_required');
        if (
          p.claimType !== undefined &&
          !(typeof p.claimType === 'string' && p.claimType in CLAIM_TYPES)
        ) {
          detail.push('invalid_claim_type');
        }
        if (!successCriterion) detail.push('success_criterion_required');
        let dueAt: string | null = null;
        if (p.dueAt !== undefined && p.dueAt !== null) {
          if (typeof p.dueAt !== 'string' || !p.dueAt.trim() || Number.isNaN(Date.parse(p.dueAt))) {
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
        const requestedScope = { jurisdictionId, processId };
        try {
          const mutation = await db.transaction(
            async (tx) => {
              const gate = await assertCanPublish(tx, citizenId, params.id, requestedScope);
              if (gate) {
                throw new RepresentativeAuthorizationDeniedError(
                  gate.body,
                  params.id,
                  requestedScope,
                );
              }
              if (claimIdInput) {
                const claimRows = await tx
                  .select({ id: schema.claims.id })
                  .from(schema.claims)
                  .where(eq(schema.claims.id, claimIdInput))
                  .limit(1);
                if (!claimRows[0]) {
                  throw new RepresentativeNotFoundError({
                    error: 'claim_not_found',
                    id: claimIdInput,
                  });
                }
              }
              await requiredAudit({
                eventType: 'representative.commitment.publish_authorized',
                action: 'publish_authorized',
                actor: { type: 'user', id: citizenId },
                target: { type: 'mandate-holder', id: params.id },
                data: { mandateHolderId: params.id, requestedScope },
              });
              const claimId =
                claimIdInput ||
                (
                  await tx
                    .insert(schema.claims)
                    .values({
                      id: sql`gen_random_uuid()::text`,
                      text,
                      claimType,
                      subjectType: 'mandate_holder',
                      subjectId: params.id,
                      confidence: '0.5',
                      confidenceState: 'unsupported_draft',
                      reviewState: 'approved',
                      visibility: 'public',
                      methodVersion: 'm-ra-phase2',
                    })
                    .returning({ id: schema.claims.id })
                )[0].id;
              const commitmentRows = await tx
                .insert(schema.commitments)
                .values({
                  id: sql`gen_random_uuid()::text`,
                  claimId,
                  mandateHolderId: params.id,
                  processId,
                  jurisdictionId,
                  successCriterion,
                  dueAt: dueAt ? new Date(dueAt) : null,
                })
                .returning();
              const commitment = commitmentRows[0];
              await tx.insert(schema.commitmentStatusEvents).values({
                id: sql`gen_random_uuid()::text`,
                commitmentId: commitment.id,
                status:
                  p.status && p.status in NON_TERMINAL_COMMITMENT_STATUSES ? p.status : 'proposed',
                resolutionClaimId: null,
                decidedBy: citizenId,
                decidedAt: new Date(),
              });
              const payload = {
                kind: 'commitment',
                mandateHolderId: params.id,
                commitmentId: commitment.id,
                claimId,
                successCriterion,
                dueAt,
                processId,
                jurisdictionId,
                evidence: p.evidence ?? null,
              };
              const submissionRows = await tx
                .insert(schema.submissions)
                .values({
                  id: sql`gen_random_uuid()::text`,
                  contributorId: citizenId,
                  type: 'claim',
                  status: 'approved',
                  contributionClass: 'mandate_commitment',
                  decidedAt: new Date(),
                  payload,
                })
                .returning();
              const row = submissionRows[0];
              const evidence = await persistRepresentativeEvidence({
                db: tx,
                evidence: p.evidence,
                claimId,
              });
              await requiredAudit({
                eventType: 'representative.commitment.published',
                action: 'publish',
                actor: { type: 'user', id: citizenId },
                target: { type: 'commitment', id: commitment.id },
                data: { mandateHolderId: params.id, claimId, submissionId: row.id },
              });
              return { commitment, evidence, row, claimId };
            },
            { isolationLevel: 'serializable' },
          );
          if (mutation.evidence.redactionRelevant) {
            await emitAudit({
              eventType: 'representative.commitment.evidence_attached',
              action: 'attach_evidence',
              target: { type: 'commitment', id: mutation.commitment.id },
              data: {
                mandateHolderId: params.id,
                claimId: mutation.claimId,
                submissionId: mutation.row.id,
                evidenceCount: mutation.evidence.evidenceCount,
                redactionRelevant: true,
              },
            });
          }
          return result(201, submissionWire(mutation.row));
        } catch (error) {
          if (error instanceof RepresentativeAuthorizationDeniedError) {
            await emitRepresentativeDeniedAudit({
              eventType: 'representative.commitment.publish_denied',
              action: 'publish_denied',
              target: { type: 'mandate-holder', id: params.id },
              citizenId,
              mandateHolderId: error.mandateHolderId,
              denial: error.denial,
              requestedScope: error.requestedScope,
            });
            return result(403, error.denial);
          }
          if (error instanceof RepresentativeNotFoundError) {
            return result(404, error.body);
          }
          if (error instanceof AuditUnavailableError) {
            return result(503, { error: 'audit_unavailable' });
          }
          throw error;
        }
      },
    },
    {
      method: 'POST',
      path: '/internal/commitments/:id/resolutions',
      handler: async (req, body, params) => {
        const rawCitizen = req.headers['x-polis-citizen'];
        const citizenId = typeof rawCitizen === 'string' ? rawCitizen.trim() : '';
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const p = (body ?? {}) as {
          status?: string;
          text?: string;
          claimType?: string;
          evidence?: unknown;
          resolutionClaimId?: string;
        };
        if (!p.status || !(p.status in RESOLUTION_STATUSES)) {
          return result(400, { error: 'invalid_resolution_status' });
        }
        const text = typeof p.text === 'string' ? p.text.trim() : '';
        const claimType =
          typeof p.claimType === 'string' && p.claimType in CLAIM_TYPES
            ? p.claimType
            : 'public_statement';
        const resolutionClaimIdInput = optionalNonEmpty(p.resolutionClaimId);
        if (
          p.claimType !== undefined &&
          !(typeof p.claimType === 'string' && p.claimType in CLAIM_TYPES)
        ) {
          return result(400, { error: 'invalid_claim_type' });
        }
        if (!resolutionClaimIdInput && !text) {
          return result(400, { error: 'resolution_claim_text_required' });
        }
        try {
          const mutation = await db.transaction(
            async (tx) => {
              const commitmentRows = await tx
                .select({
                  mandateHolderId: schema.commitments.mandateHolderId,
                  jurisdictionId: schema.commitments.jurisdictionId,
                  processId: schema.commitments.processId,
                })
                .from(schema.commitments)
                .where(eq(schema.commitments.id, params.id))
                .limit(1);
              const commitment = commitmentRows[0];
              if (!commitment) {
                throw new RepresentativeNotFoundError({ error: 'not_found', id: params.id });
              }
              const requestedScope = {
                jurisdictionId: commitment.jurisdictionId ?? null,
                processId: commitment.processId ?? null,
              };
              const gate = await assertCanPublish(
                tx,
                citizenId,
                commitment.mandateHolderId,
                requestedScope,
              );
              if (gate) {
                throw new RepresentativeAuthorizationDeniedError(
                  gate.body,
                  commitment.mandateHolderId,
                  requestedScope,
                );
              }
              if (resolutionClaimIdInput) {
                const claimRows = await tx
                  .select({ id: schema.claims.id })
                  .from(schema.claims)
                  .where(eq(schema.claims.id, resolutionClaimIdInput))
                  .limit(1);
                if (!claimRows[0]) {
                  throw new RepresentativeNotFoundError({
                    error: 'claim_not_found',
                    id: resolutionClaimIdInput,
                  });
                }
              }
              await requiredAudit({
                eventType: 'representative.commitment.resolution_authorized',
                action: 'resolution_authorized',
                actor: { type: 'user', id: citizenId },
                target: { type: 'commitment', id: params.id },
                data: {
                  mandateHolderId: commitment.mandateHolderId,
                  requestedScope,
                },
              });
              const resolutionClaimId =
                resolutionClaimIdInput ??
                (
                  await tx
                    .insert(schema.claims)
                    .values({
                      id: sql`gen_random_uuid()::text`,
                      text,
                      claimType,
                      subjectType: 'commitment',
                      subjectId: params.id,
                      confidence: '0.5',
                      confidenceState: 'unsupported_draft',
                      reviewState: 'draft',
                      visibility: 'public',
                      methodVersion: 'm-ra-phase2',
                    })
                    .returning({ id: schema.claims.id })
                )[0].id;
              const payload = {
                kind: 'resolution',
                commitmentId: params.id,
                status: p.status,
                resolutionClaimId,
                evidence: p.evidence ?? null,
              };
              const submissionRows = await tx
                .insert(schema.submissions)
                .values({
                  id: sql`gen_random_uuid()::text`,
                  contributorId: citizenId,
                  type: 'claim',
                  status: 'pending',
                  decidedAt: null,
                  contributionClass: 'mandate_commitment',
                  payload,
                })
                .returning();
              const row = submissionRows[0];
              const evidence = await persistRepresentativeEvidence({
                db: tx,
                evidence: p.evidence,
                claimId: resolutionClaimId,
              });
              await requiredAudit({
                eventType: 'representative.commitment.resolution_filed',
                action: 'submit',
                actor: { type: 'user', id: citizenId },
                target: { type: 'contribution', id: row.id },
                data: { commitmentId: params.id, status: p.status, resolutionClaimId },
              });
              return { evidence, resolutionClaimId, row };
            },
            { isolationLevel: 'serializable' },
          );
          if (mutation.evidence.redactionRelevant) {
            await emitAudit({
              eventType: 'representative.commitment.resolution_evidence_attached',
              action: 'attach_evidence',
              target: { type: 'contribution', id: mutation.row.id },
              data: {
                commitmentId: params.id,
                status: p.status,
                resolutionClaimId: mutation.resolutionClaimId,
                evidenceCount: mutation.evidence.evidenceCount,
                redactionRelevant: true,
              },
            });
          }
          return result(201, submissionWire(mutation.row));
        } catch (error) {
          if (error instanceof RepresentativeAuthorizationDeniedError) {
            await emitRepresentativeDeniedAudit({
              eventType: 'representative.commitment.resolution_denied',
              action: 'resolution_denied',
              target: { type: 'commitment', id: params.id },
              citizenId,
              mandateHolderId: error.mandateHolderId,
              denial: error.denial,
              requestedScope: error.requestedScope,
            });
            return result(403, error.denial);
          }
          if (error instanceof RepresentativeNotFoundError) {
            return result(404, error.body);
          }
          if (error instanceof AuditUnavailableError) {
            return result(503, { error: 'audit_unavailable' });
          }
          throw error;
        }
      },
    },
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
        if (!text) {
          return result(400, { error: 'invalid_question_payload', detail: ['body_required'] });
        }
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
        // Return the gate's HTTP response, not the wrapper: returning `gate`
        // serialized the denial as a 200 and made this route fail open.
        if (gate) return gate.response;
        const input = (body ?? {}) as { body?: string };
        const answerText = typeof input.body === 'string' ? input.body.trim() : '';
        if (!answerText)
          return result(400, { error: 'invalid_answer_payload', detail: ['body_required'] });
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
  ];
}

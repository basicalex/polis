import { fetchWithTimeout, internalHeaders } from '@polis/service-runtime';
import type { PublishDenial, RequestedCommitmentScope } from './representative-publish-gate.js';
import type { AuditEvent } from './types.js';

const AUDIT_TIMEOUT_MS = 5_000;

async function postAudit(event: AuditEvent): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  const headers = internalHeaders();
  const response = await fetchWithTimeout(
    base + '/internal/audit/events',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: event.visibility ?? 'public',
        actor: event.actor ?? { type: 'service', id: 'contribution-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    },
    AUDIT_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`audit-service returned ${response.status}`);
}

/** Existing post-mutation domain events remain best-effort, but failures are explicit. */
export async function emitAudit(event: AuditEvent): Promise<void> {
  try {
    await postAudit(event);
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'contribution-service',
        stage: 'audit-emit',
        warning: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

export class AuditUnavailableError extends Error {
  constructor() {
    super('required audit unavailable');
    this.name = 'AuditUnavailableError';
  }
}

export async function requiredAudit(event: AuditEvent): Promise<void> {
  try {
    await postAudit({ ...event, visibility: 'restricted' });
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'contribution-service',
        stage: 'audit-required',
        warning: error instanceof Error ? error.message : 'unknown',
      }),
    );
    throw new AuditUnavailableError();
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
export async function emitRewardEligibility(input: {
  submissionId: string;
  contributorId: string;
  contributionClass: string;
}): Promise<void> {
  const base = process.env.REWARDS_INTERNAL_URL ?? 'http://localhost:8460';
  try {
    await fetch(base + '/internal/rewards/eligibility', {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        submissionId: input.submissionId,
        contributorId: input.contributorId,
        contributionClass: input.contributionClass,
      }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'contribution-service',
        stage: 'reward-eligibility-emit',
        warning: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

export async function emitRepresentativeDeniedAudit(input: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  citizenId: string;
  mandateHolderId: string;
  denial: PublishDenial;
  requestedScope: RequestedCommitmentScope;
}): Promise<void> {
  await emitAudit({
    eventType: input.eventType,
    action: input.action,
    target: input.target,
    visibility: 'restricted',
    data: {
      citizenId: input.citizenId,
      mandateHolderId: input.mandateHolderId,
      denied: true,
      reason: input.denial.reason,
      error: input.denial.error,
      field: input.denial.field ?? null,
      requestedScope: input.requestedScope,
    },
  });
}

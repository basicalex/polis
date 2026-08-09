import type { IncomingMessage } from 'node:http';
import { fetchWithTimeout, internalHeaders, result, type HttpResult } from '@polis/service-runtime';

import type { AuditSpec, MutationOutcome, MutationSuccess } from './types.js';

const AUDIT_TIMEOUT_MS = 5_000;

export function correlationId(req: IncomingMessage): string | null {
  const value = req.headers['x-correlation-id'];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

function isMutationSuccess<T>(value: MutationOutcome<T>): value is MutationSuccess<T> {
  return typeof value === 'object' && value !== null && 'audit' in value;
}

async function emitAudit(spec: AuditSpec): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetchWithTimeout(
      base + '/internal/audit/events',
      {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          eventType: `complaint.${spec.action}`,
          action: spec.action,
          visibility: 'restricted',
          actor: { type: 'user', id: spec.actor.citizenId },
          target: { type: 'complaint_case', id: spec.caseId },
          correlationId: spec.correlationId,
          data: {
            actorRole: spec.actorRole,
            fromStatus: spec.fromStatus,
            toStatus: spec.toStatus,
            ...(spec.data ?? {}),
          },
        }),
      },
      AUDIT_TIMEOUT_MS,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'complaints-service',
        stage: 'audit-emit',
        warning: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

export async function finishMutation<T>(outcome: MutationOutcome<T>): Promise<HttpResult> {
  if (!isMutationSuccess(outcome)) return outcome;
  await emitAudit(outcome.audit);
  return result(outcome.status, outcome.value);
}

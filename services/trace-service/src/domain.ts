import type { Actor, RecordRow, TraceConfig, TraceRole, TraceStatus } from './types.js';

export function roleForActor(config: TraceConfig, actorId: string): TraceRole {
  if (config.officialIds.has(actorId)) return 'official';
  if (config.reviewerIds.has(actorId)) return 'reviewer';
  return 'resident';
}

export function canReadPrivate(actor: Actor, record: Pick<RecordRow, 'owner_actor_id'>): boolean {
  return actor.role !== 'resident' || actor.id === record.owner_actor_id;
}

export function canUpload(actor: Actor, record: Pick<RecordRow, 'owner_actor_id'>): boolean {
  return actor.id === record.owner_actor_id || actor.role === 'official';
}

export function isCommitmentSourceState(status: TraceStatus): boolean {
  return status === 'assigned' || status === 'returned';
}

export function transitionAllowed(
  command:
    | 'assign'
    | 'commitment'
    | 'review-accept'
    | 'review-return'
    | 'resolution'
    | 'resolution-review-accept'
    | 'resolution-review-return',
  status: TraceStatus,
): boolean {
  switch (command) {
    case 'assign':
      return status === 'open';
    case 'commitment':
      return isCommitmentSourceState(status);
    case 'review-accept':
    case 'review-return':
      return status === 'commitment-pending-review';
    case 'resolution':
      return status === 'published';
    case 'resolution-review-accept':
    case 'resolution-review-return':
      return status === 'resolution-pending-review';
  }
}

export function assertExpectedVersion(expected: number, actual: number): void {
  if (expected !== actual)
    throw new DomainError(409, 'stale_version', 'The record version is stale.');
}

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function requireRole(actor: Actor, role: TraceRole): void {
  if (actor.role !== role)
    throw new DomainError(403, 'forbidden', 'This role cannot perform the requested action.');
}

export function requireTransition(allowed: boolean): void {
  if (!allowed)
    throw new DomainError(409, 'invalid_state', 'The record is not in the required state.');
}

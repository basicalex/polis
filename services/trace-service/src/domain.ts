// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import {
  ASSESSMENT_HOLD_REASONS,
  type Actor,
  type HoldReason,
  type PublicTextMode,
  type RecordRow,
  type ShellState,
  type TextStatus,
  type TraceConfig,
  type TraceRole,
  type TraceStatus,
} from './types.js';

export function roleForActor(config: TraceConfig, actorId: string): TraceRole {
  if (config.officialIds.has(actorId)) return 'official';
  if (config.gatewayIds?.has(actorId)) return 'gateway';
  return 'resident';
}

export function canReadPrivate(
  actor: Actor,
  record: Pick<RecordRow, 'id' | 'owner_actor_id' | 'gateway_actor_id'>,
): boolean {
  if (actor.recordScope !== undefined) return actor.recordScope === record.id;
  if (actor.role === 'gateway') return actor.id === record.gateway_actor_id;
  return actor.role !== 'resident' || actor.id === record.owner_actor_id;
}

export function canUpload(actor: Actor, record: Pick<RecordRow, 'owner_actor_id'>): boolean {
  return actor.id === record.owner_actor_id || actor.role === 'official';
}

export function isAssessmentHoldReason(
  reason: HoldReason,
): reason is (typeof ASSESSMENT_HOLD_REASONS)[number] {
  return (ASSESSMENT_HOLD_REASONS as readonly HoldReason[]).includes(reason);
}

export function holdReasonAtFiling(
  mode: PublicTextMode,
  assessmentHold: HoldReason | null,
): HoldReason | null {
  if (assessmentHold === 'confidential') return 'confidential';
  if (mode === 'shell') return 'policy';
  if (assessmentHold !== null) return assessmentHold;
  return mode === 'release' ? 'pending-release' : null;
}

export function canReleaseText(
  mode: PublicTextMode,
  textStatus: TextStatus,
): 'release_not_permitted' | 'text_removed' | null {
  if (textStatus === 'removed') return 'text_removed';
  if (mode === 'shell') return 'release_not_permitted';
  return null;
}

export function canCloseCase(status: TraceStatus): boolean {
  return status === 'open' || status === 'assigned';
}

export function transitionAllowed(
  command: 'assign' | 'commitment' | 'resolution' | 'reopen' | 'dispute' | 'close',
  status: TraceStatus,
): boolean {
  switch (command) {
    case 'assign':
      return status === 'open';
    case 'commitment':
      return status === 'assigned';
    case 'resolution':
      return status === 'answered' || status === 'disputed';
    case 'reopen':
      return status === 'disputed';
    case 'dispute':
      return status === 'resolved';
    case 'close':
      return canCloseCase(status);
  }
}

export function shellStateFor(status: TraceStatus): ShellState {
  return status === 'open' ? 'received' : status;
}

export function reopenKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function parseCaseNumberTarget(text: string): string | null {
  const match = /^vrs-(\d{1,8})\b/i.exec(text);
  return match ? `VRS-${match[1]}` : null;
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

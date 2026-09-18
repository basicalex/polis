// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import type {
  CaseShell,
  PublicEvent,
  PublicEventData,
  PublicRecord,
  TraceRole,
  TraceStage,
  TraceStatus,
} from './types.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('canonical JSON rejects unsupported values');
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface EventHashMaterial {
  id: string;
  recordId: string;
  sequence: number;
  previousHash: string | null;
  stage: TraceStage;
  action: string;
  actorId: string;
  actorRole: TraceRole;
  note: string | null;
  payload: Record<string, unknown>;
  resultingVersion: number;
  resultingStatus: TraceStatus;
  createdAt: string;
}

export function buildEventHashMaterial(event: EventHashMaterial): EventHashMaterial {
  return {
    id: event.id,
    recordId: event.recordId,
    sequence: event.sequence,
    previousHash: event.previousHash,
    stage: event.stage,
    action: event.action,
    actorId: event.actorId,
    actorRole: event.actorRole,
    note: event.note,
    payload: event.payload,
    resultingVersion: event.resultingVersion,
    resultingStatus: event.resultingStatus,
    createdAt: event.createdAt,
  };
}

export function computeEventHash(event: EventHashMaterial): string {
  return sha256(canonicalJson(buildEventHashMaterial(event)));
}

export interface StoredEvent extends EventHashMaterial {
  hash: string;
}

export type EventVerification =
  | { valid: true }
  | {
      valid: false;
      error:
        | 'invalid_sequence'
        | 'broken_previous_hash'
        | 'event_hash_mismatch'
        | 'record_state_mismatch';
      sequence?: number;
    };

export function verifyEventChain(
  events: readonly StoredEvent[],
  record?: { version: number; status: TraceStatus },
): EventVerification {
  let previousHash: string | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      return { valid: false, error: 'invalid_sequence', sequence: event.sequence };
    }
    if (event.previousHash !== previousHash) {
      return { valid: false, error: 'broken_previous_hash', sequence: event.sequence };
    }
    if (computeEventHash(event) !== event.hash) {
      return { valid: false, error: 'event_hash_mismatch', sequence: event.sequence };
    }
    previousHash = event.hash;
  }
  if (record) {
    const latest = events.at(-1);
    if (
      !latest ||
      latest.resultingVersion !== record.version ||
      latest.resultingStatus !== record.status
    ) {
      return { valid: false, error: 'record_state_mismatch' };
    }
  }
  return { valid: true };
}
export function computePublicEventHash(event: PublicEventData, previousHash: string): string {
  return sha256(canonicalJson(event) + previousHash);
}

export function chainPublicEvents(events: readonly PublicEventData[]): PublicEvent[] {
  let previousHash = '';
  return events.map((event) => {
    const hash = computePublicEventHash(event, previousHash);
    const chained: PublicEvent = { ...event, previousHash, hash };
    previousHash = hash;
    return chained;
  });
}

export function verifyPublicEventChain(events: readonly PublicEvent[]): boolean {
  let previousHash = '';
  for (const event of events) {
    if (event.previousHash !== previousHash) return false;
    const { hash, previousHash: _storedPreviousHash, ...material } = event;
    if (computePublicEventHash(material as PublicEventData, previousHash) !== hash) return false;
    previousHash = hash;
  }
  return true;
}


export const RECEIPT_HASH_FIELDS = [
  'id',
  'municipalityId',
  'category',
  'office',
  'status',
  'commitment',
  'dueDate',
  'signedBy',
  'evidenceNote',
  'evidenceUrls',
  'publishedAt',
  'resolvedAt',
  'disputes',
  'lastEventHash',
  'events',
  'testEnvironment',
] as const;

export type ReceiptHashField = (typeof RECEIPT_HASH_FIELDS)[number];
export type ReceiptHashMaterial = Pick<PublicRecord, ReceiptHashField>;

export function buildReceiptHashMaterial(
  record: Omit<PublicRecord, 'receiptHash' | 'caseNumber'>,
): ReceiptHashMaterial {
  return {
    id: record.id,
    municipalityId: record.municipalityId,
    category: record.category,
    office: record.office,
    status: record.status,
    commitment: record.commitment,
    dueDate: record.dueDate,
    signedBy: { ...record.signedBy },
    evidenceNote: record.evidenceNote,
    evidenceUrls: [...record.evidenceUrls],
    publishedAt: record.publishedAt,
    resolvedAt: record.resolvedAt,
    disputes: record.disputes.map((dispute) => ({ ...dispute })),
    lastEventHash: record.lastEventHash,
    events: record.events.map((event) => ({ ...event })),
    testEnvironment: record.testEnvironment,
  };
}

export function computeReceiptHash(
  record: Omit<PublicRecord, 'receiptHash' | 'caseNumber'>,
): string {
  return sha256(canonicalJson(buildReceiptHashMaterial(record)));
}

export function verifyReceiptHash(
  record: PublicRecord | Omit<PublicRecord, 'caseNumber'>,
): boolean {
  return computeReceiptHash(record) === record.receiptHash;
}

export const CASE_SHELL_HASH_FIELDS = [
  'caseNumber',
  'municipalityId',
  'area',
  'category',
  'track',
  'state',
  'text',
  'location',
  'textStatus',
  'holdReason',
  'removedReason',
  'textHashKind',
  'unitId',
  'textSha256',
  'labels',
  'closedPublicReason',
  'filedAt',
  'clockDueAt',
  'followerCount',
  'alsoAffectedCount',
  'notFixedCount',
  'disputeCount',
  'noticeCount',
  'testEnvironment',
] as const;

export type ShellHashField = (typeof CASE_SHELL_HASH_FIELDS)[number];
export type ShellHashMaterial = Pick<CaseShell, ShellHashField>;

export function buildShellHashMaterial(
  shell: Omit<CaseShell, 'shellHash'> | CaseShell,
): ShellHashMaterial {
  return {
    caseNumber: shell.caseNumber,
    municipalityId: shell.municipalityId,
    area: shell.area,
    category: shell.category,
    track: shell.track,
    state: shell.state,
    text: shell.text,
    location: shell.location,
    textStatus: shell.textStatus,
    holdReason: shell.holdReason,
    removedReason: shell.removedReason,
    textHashKind: shell.textHashKind,
    unitId: shell.unitId,
    textSha256: shell.textSha256,
    labels: [...shell.labels].sort(),
    closedPublicReason: shell.closedPublicReason,
    filedAt: shell.filedAt,
    clockDueAt: shell.clockDueAt,
    followerCount: shell.followerCount,
    alsoAffectedCount: shell.alsoAffectedCount,
    notFixedCount: shell.notFixedCount,
    disputeCount: shell.disputeCount,
    noticeCount: shell.noticeCount,
    testEnvironment: shell.testEnvironment,
  };
}

export function computeShellHash(shell: Omit<CaseShell, 'shellHash'> | CaseShell): string {
  return sha256(canonicalJson(buildShellHashMaterial(shell)));
}

export function verifyShellHash(shell: CaseShell): boolean {
  return computeShellHash(shell) === shell.shellHash;
}

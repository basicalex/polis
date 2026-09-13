// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PilotLang } from '../../../content/pilot/vrsar';

export type PilotRole = 'resident' | 'official' | 'reviewer';
export type TraceStatus =
  | 'open'
  | 'assigned'
  | 'commitment-pending-review'
  | 'returned'
  | 'published'
  | 'resolution-pending-review'
  | 'resolved'
  | 'closed';

/** How the filer reached the office. The web form is one channel among three. */
export type TraceOrigin = 'web' | 'sms' | 'voice';
export type FilerKind = 'account' | 'anonymous-channel';
export type ClosedReason =
  | 'duplicate'
  | 'out-of-scope'
  | 'withdrawn'
  | 'insufficient-information'
  | 'no-action-possible'
  | 'resolved-elsewhere';
export const CLOSED_REASONS: readonly ClosedReason[] = [
  'duplicate',
  'out-of-scope',
  'withdrawn',
  'insufficient-information',
  'no-action-possible',
  'resolved-elsewhere',
];
export type CaseShellState =
  | 'received'
  | 'assigned'
  | 'in-review'
  | 'published'
  | 'resolved'
  | 'closed';

export interface LocalizedName {
  hr?: string;
  it?: string;
  en?: string;
  [key: string]: unknown;
}

export interface PilotConfigEntity {
  id?: string;
  name?: LocalizedName | string;
  label?: LocalizedName | string;
  [key: string]: unknown;
}

export interface PilotSource {
  label?: LocalizedName | string;
  name?: LocalizedName | string;
  title?: LocalizedName | string;
  url: string;
}

export interface PilotConfig {
  municipality: PilotConfigEntity;
  category: PilotConfigEntity;
  office: PilotConfigEntity;
  testEnvironment: true;
  intakeOpen: boolean;
  sources: PilotSource[];
}

export interface PilotSession {
  actorId: string;
  email?: string;
  role: PilotRole;
  municipalityId: string;
}

export type CaseMessageDirection = 'inbound' | 'outbound';
export type CaseMessageKind =
  | 'append'
  | 'answer'
  | 'question'
  | 'status-update'
  | 'receipt'
  | 'transcript'
  | 'transcript-failed';
export type CaseMessageSource = 'typed' | 'transcript' | 'system';
export type CaseMessageAuthorKind = 'filer' | 'official' | 'reviewer' | 'system';
export type CaseMessageDeliveryState =
  | 'pending'
  | 'handed-off'
  | 'delivered'
  | 'failed'
  | 'not-applicable';

/** One message on the case. The filer's phone number never reaches this view. */
export interface CaseMessage {
  id: string;
  recordId: string;
  direction: CaseMessageDirection;
  kind: CaseMessageKind;
  channel: TraceOrigin;
  source: CaseMessageSource;
  body: string;
  authorKind: CaseMessageAuthorKind;
  authorActorId?: string | null;
  inReplyTo?: string | null;
  deliveryState: CaseMessageDeliveryState;
  deliveryFailureCode?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
}

export type AiProposalKind = 'category' | 'location' | 'duplicate-of' | 'office';
export type AiProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';

/** A machine suggestion. It changes nothing until an official or reviewer decides. */
export interface AiProposal {
  id: string;
  recordId: string;
  kind: AiProposalKind;
  proposedValue: Record<string, unknown>;
  confidence: number;
  modelId: string;
  modelVersion: string;
  status: AiProposalStatus;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  createdAt: string;
}

/** The public shell of a case: it exists in every state, with no private text. */
export interface PublicCaseShell {
  caseNumber: string;
  municipalityId: string;
  area: string;
  category: string;
  track: 'standard';
  state: CaseShellState;
  closedPublicReason: string | null;
  filedAt: string;
  clockDueAt: string | null;
  followerCount: number;
  alsoAffectedCount: number;
  shellHash: string;
  updatedAt: string;
  testEnvironment: true;
}

export interface TraceAttachment {
  id: string;
  filename: string;
  contentType?: string;
  size?: number;
  sha256?: string;
  createdAt?: string;
}

export interface TraceEvent {
  id?: string;
  sequence?: number;
  stage: 'voice' | 'responsibility' | 'response' | 'check' | 'receipt' | string;
  action: string;
  actorRole: PilotRole | string;
  note?: string;
  createdAt: string;
  previousHash?: string;
  hash?: string;
}

export function latestTraceEvent(events: readonly TraceEvent[], stage: string): TraceEvent | undefined {
  let selected: TraceEvent | undefined;
  let selectedIndex = -1;
  for (const [index, event] of events.entries()) {
    if (event.stage !== stage) continue;
    if (!selected) {
      selected = event;
      selectedIndex = index;
      continue;
    }
    const eventSequence = typeof event.sequence === 'number' ? event.sequence : null;
    const selectedSequence = typeof selected.sequence === 'number' ? selected.sequence : null;
    if (eventSequence !== null && selectedSequence !== null && eventSequence !== selectedSequence) {
      if (eventSequence > selectedSequence) {
        selected = event;
        selectedIndex = index;
      }
      continue;
    }
    const eventTime = Date.parse(event.createdAt);
    const selectedTime = Date.parse(selected.createdAt);
    if (Number.isFinite(eventTime) && Number.isFinite(selectedTime) && eventTime !== selectedTime) {
      if (eventTime > selectedTime) {
        selected = event;
        selectedIndex = index;
      }
      continue;
    }
    if (index > selectedIndex) {
      selected = event;
      selectedIndex = index;
    }
  }
  return selected;
}

export interface PrivateTraceRecord {
  id: string;
  municipalityId: string;
  category: string | PilotConfigEntity;
  status: TraceStatus;
  version: number;
  subject: string;
  narrative: string;
  location: string;
  contactEmail?: string;
  office: string | PilotConfigEntity;
  publicSummary?: string;
  commitment?: string;
  dueDate?: string;
  evidenceNote?: string;
  evidenceUrls?: string[];
  createdAt: string;
  updatedAt: string;
  events: TraceEvent[];
  attachments: TraceAttachment[];
  /** The identifier a filer and the public both quote. The UUID stays internal. */
  caseNumber?: string;
  origin?: TraceOrigin;
  filerKind?: FilerKind;
  closedReason?: ClosedReason | null;
  closedPublicReason?: string | null;
  followerCount?: number;
  alsoAffectedCount?: number;
  aiProposals?: AiProposal[];
}

/** Public fields are deliberately separate from the private record type. */
export interface PublicTraceRecord {
  id: string;
  municipalityId: string;
  category: string | PilotConfigEntity;
  office: string | PilotConfigEntity;
  status: 'published' | 'resolved';
  publicSummary: string;
  commitment: string;
  dueDate: string;
  evidenceNote?: string;
  evidenceUrls?: string[];
  publishedAt: string;
  resolvedAt?: string;
  events: TraceEvent[];
  receiptHash: string;
  testEnvironment: true;
}

export function isPilotRole(value: unknown): value is PilotRole {
  return value === 'resident' || value === 'official' || value === 'reviewer';
}

export function isTraceStatus(value: unknown): value is TraceStatus {
  return (
    value === 'open' ||
    value === 'assigned' ||
    value === 'commitment-pending-review' ||
    value === 'returned' ||
    value === 'published' ||
    value === 'resolution-pending-review' ||
    value === 'resolved' ||
    value === 'closed'
  );
}

export function recordFromEnvelope(value: unknown): PrivateTraceRecord {
  if (!value || typeof value !== 'object' || !('record' in value)) throw new Error('invalid_record_response');
  const record = (value as { record?: unknown }).record;
  if (!record || typeof record !== 'object') throw new Error('invalid_record_response');
  return record as PrivateTraceRecord;
}

export function publicRecordFromEnvelope(value: unknown): PublicTraceRecord {
  if (!value || typeof value !== 'object' || !('record' in value)) throw new Error('invalid_public_record_response');
  const record = (value as { record?: unknown }).record;
  if (!record || typeof record !== 'object') throw new Error('invalid_public_record_response');
  return record as PublicTraceRecord;
}

function envelopeMember(value: unknown, key: string, error: string): unknown {
  if (!value || typeof value !== 'object' || !(key in value)) throw new Error(error);
  return (value as Record<string, unknown>)[key];
}

export function messagesFromEnvelope(value: unknown): CaseMessage[] {
  const messages = envelopeMember(value, 'messages', 'invalid_messages_response');
  if (!Array.isArray(messages)) throw new Error('invalid_messages_response');
  return messages as CaseMessage[];
}

export function messageResultFromEnvelope(value: unknown): {
  message: CaseMessage;
  record: PrivateTraceRecord;
} {
  const message = envelopeMember(value, 'message', 'invalid_message_response');
  if (!message || typeof message !== 'object') throw new Error('invalid_message_response');
  return { message: message as CaseMessage, record: recordFromEnvelope(value) };
}

export function proposalDecisionFromEnvelope(value: unknown): {
  proposal: AiProposal;
  record: PrivateTraceRecord;
} {
  const proposal = envelopeMember(value, 'proposal', 'invalid_proposal_response');
  if (!proposal || typeof proposal !== 'object') throw new Error('invalid_proposal_response');
  return { proposal: proposal as AiProposal, record: recordFromEnvelope(value) };
}

export function closeResultFromEnvelope(value: unknown): {
  record: PrivateTraceRecord;
  shell: PublicCaseShell;
} {
  const shell = envelopeMember(value, 'shell', 'invalid_close_response');
  if (!shell || typeof shell !== 'object') throw new Error('invalid_close_response');
  return { record: recordFromEnvelope(value), shell: shell as PublicCaseShell };
}

export function publicCasesFromEnvelope(value: unknown): PublicCaseShell[] {
  const cases = envelopeMember(value, 'cases', 'invalid_public_cases_response');
  if (!Array.isArray(cases)) throw new Error('invalid_public_cases_response');
  return cases as PublicCaseShell[];
}

export function publicCaseFromEnvelope(value: unknown): {
  case: PublicCaseShell;
  record: PublicTraceRecord | null;
} {
  const shell = envelopeMember(value, 'case', 'invalid_public_case_response');
  if (!shell || typeof shell !== 'object') throw new Error('invalid_public_case_response');
  const record = value && typeof value === 'object' ? (value as { record?: unknown }).record : null;
  return {
    case: shell as PublicCaseShell,
    record: record && typeof record === 'object' ? (record as PublicTraceRecord) : null,
  };
}

export function anonymousCaseFromEnvelope(value: unknown): {
  caseNumber: string;
  reopenKey: string;
  state: string;
} {
  const created = envelopeMember(value, 'case', 'invalid_anonymous_case_response');
  if (!created || typeof created !== 'object') {
    throw new Error('invalid_anonymous_case_response');
  }
  const shape = created as {
    caseNumber?: unknown;
    reopenKey?: unknown;
    state?: unknown;
  };
  if (
    typeof shape.caseNumber !== 'string' ||
    !shape.caseNumber ||
    typeof shape.reopenKey !== 'string' ||
    !shape.reopenKey ||
    typeof shape.state !== 'string' ||
    !shape.state
  ) {
    throw new Error('invalid_anonymous_case_response');
  }
  return {
    caseNumber: shape.caseNumber,
    reopenKey: shape.reopenKey,
    state: shape.state,
  };
}

export function attentionCountsFromEnvelope(value: unknown): {
  followerCount: number;
  alsoAffectedCount: number;
} {
  const counts = envelopeMember(value, 'counts', 'invalid_attention_response');
  if (!counts || typeof counts !== 'object') throw new Error('invalid_attention_response');
  const shape = counts as { followerCount?: unknown; alsoAffectedCount?: unknown };
  if (typeof shape.followerCount !== 'number' || typeof shape.alsoAffectedCount !== 'number') {
    throw new Error('invalid_attention_response');
  }
  return { followerCount: shape.followerCount, alsoAffectedCount: shape.alsoAffectedCount };
}

export function recordsFromEnvelope<T>(value: unknown): T[] {
  if (!value || typeof value !== 'object' || !('records' in value)) throw new Error('invalid_records_response');
  const records = (value as { records?: unknown }).records;
  if (!Array.isArray(records)) throw new Error('invalid_records_response');
  return records as T[];
}

export function entityName(entity: unknown, lang: PilotLang): string {
  if (typeof entity === 'string') return entity;
  if (!entity || typeof entity !== 'object') return '';
  const candidate = entity as PilotConfigEntity;
  const value = candidate.name ?? candidate.label;
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return candidate.id ?? '';
  const localized = value as LocalizedName;
  for (const key of [lang, 'hr', 'it', 'en'] as const) {
    if (typeof localized[key] === 'string' && localized[key]) return localized[key] as string;
  }
  return candidate.id ?? '';
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function safeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

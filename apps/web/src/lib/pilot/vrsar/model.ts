// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PilotLang } from '../../../content/pilot/vrsar';

export type PilotRole = 'resident' | 'official';
export type TraceRole = 'resident' | 'official' | 'gateway' | 'system';
export type TraceStatus =
  | 'open'
  | 'assigned'
  | 'answered'
  | 'resolved'
  | 'disputed'
  | 'closed';

/** How the filer reached the office. The web form is one channel among three. */
export type TraceOrigin = 'web' | 'sms' | 'voice';
/** `raw` is sha256 of the text as filed; the legacy one is the normalised hash. */
export type TextHashKind = 'raw' | 'normalized-legacy';
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
  | 'answered'
  | 'resolved'
  | 'disputed'
  | 'closed';

export const ASSESSMENT_HOLD_REASONS = [
  'personal-data',
  'abuse',
  'off-topic',
  'other',
] as const;
export const HOLD_REASONS = [
  ...ASSESSMENT_HOLD_REASONS,
  'pending-release',
  'policy',
  'notices',
  'confidential',
] as const;
export type AssessmentHoldReason = (typeof ASSESSMENT_HOLD_REASONS)[number];
export type HoldReason = (typeof HOLD_REASONS)[number];
export type PublicTextMode = 'open' | 'release' | 'shell';
export type RemovedReason = 'filer' | 'retention';
export const TEXT_STATUSES = ['public', 'held', 'redacted', 'removed'] as const;
export type TextStatus = (typeof TEXT_STATUSES)[number];
export interface OfficialSignature {
  name: string;
  title: string;
}

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
  publicTextMode: PublicTextMode;
  publicTextRetentionDays: number;
  /**
   * The sections of the office. A case is assigned to one of them, and the unit
   * stands on the public record. An older config carries none, and then the
   * office assigns without naming a section.
   */
  units?: PilotConfigEntity[];
}

/**
 * The signer, read from the login rather than typed: the office profile of the
 * signed-in official. Missing profile is an answer of its own
 * (`official_profile_missing`), never an empty pair of fields.
 */
export interface OfficialProfile {
  citizenId: string;
  name: string;
  title: string;
  unit: { id: string; name: LocalizedName } | null;
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
  | 'label-appeal'
  | 'dispute'
  | 'notice'
  | 'answer'
  | 'question'
  | 'status-update'
  | 'receipt'
  | 'transcript'
  | 'transcript-failed';
export type CaseMessageSource = 'typed' | 'transcript' | 'system';
export type CaseMessageAuthorKind = 'filer' | 'official' | 'system';
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
  noticeReason: HoldReason | null;
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

/** A machine suggestion. It changes nothing until an official decides. */
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
  text: string | null;
  location: string | null;
  textStatus: TextStatus;
  holdReason: HoldReason | null;
  removedReason: RemovedReason | null;
  /** sha256 of the text as filed, lowercase hex: a reader can recompute it. */
  textSha256: string;
  /**
   * Which hash `textSha256` is. Rows written before the raw-text hash landed
   * carry the old normalised one and say so.
   */
  textHashKind?: TextHashKind;
  /** The section of the office that holds the case, once one does. */
  unitId?: string | null;
  /** Which channel filed the report; a web filing has no contact of any kind. */
  origin?: TraceOrigin;
  labels: string[];
  closedPublicReason: string | null;
  filedAt: string;
  clockDueAt: string | null;
  followerCount: number;
  alsoAffectedCount: number;
  notFixedCount: number;
  disputeCount: number;
  noticeCount: number;
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
  actorRole: TraceRole;
  note?: string;
  createdAt: string;
  previousHash?: string;
  hash?: string;
  /** Carried by `record-assigned` where the event keeps its payload. */
  unitId?: string;
  unitName?: LocalizedName;
  /** Carried by `commitment-published` where the event keeps its payload. */
  signedBy?: OfficialSignature | string;
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
  /** The section of the office that holds the case, once one took it on. */
  unitId?: string | null;
  unit?: { id: string; name: LocalizedName } | null;
  /** The name and title the answers publish under, read from the official's profile. */
  signedBy?: OfficialSignature | null;
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

/**
 * Every public event carries the fingerprint of itself and of the one before
 * it, so a reader can walk the chain without trusting the page.
 */
export interface PublicEventChain {
  hash?: string;
  previousHash?: string;
}

export type PublicEventBody =
  | {
      stage: 'voice';
      action: 'report-filed';
      actorRole: 'resident';
      createdAt: string;
    }
  | {
      stage: 'voice';
      action: 'text-held';
      actorRole: 'system' | 'official';
      reason: HoldReason;
      createdAt: string;
    }
  | {
      stage: 'voice';
      action: 'text-removed';
      actorRole: 'resident' | 'system';
      reason: RemovedReason;
      createdAt: string;
    }
  | {
      stage: 'voice';
      action: 'text-released';
      actorRole: 'official';
      redacted: boolean;
      createdAt: string;
    }
  | {
      stage: 'voice';
      action: 'label-set' | 'label-cleared';
      actorRole: 'system' | 'official';
      label: 'form-letter';
      createdAt: string;
    }
  | {
      stage: 'responsibility';
      action: 'office-assigned';
      actorRole: 'official';
      /** The section of the office that took the case on. */
      unit?: { id: string; name: LocalizedName } | null;
      createdAt: string;
    }
  | {
      stage: 'response';
      action: 'commitment-published';
      actorRole: 'official';
      /** The name alone on older snapshots; the name and the title on new ones. */
      signedBy: string | OfficialSignature;
      createdAt: string;
    }
  | {
      stage: 'check';
      action: 'completion-reported';
      actorRole: 'official';
      createdAt: string;
    }
  | {
      stage: 'check';
      action: 'completion-disputed';
      actorRole: 'resident';
      createdAt: string;
    }
  | {
      stage: 'check';
      action: 'case-reopened';
      actorRole: 'official';
      createdAt: string;
    }
  | {
      stage: 'receipt';
      action: 'case-resolved-standing';
      actorRole: 'system';
      createdAt: string;
    }
  | {
      stage: 'voice' | 'responsibility';
      action: 'case-closed';
      actorRole: 'official';
      publicReason: string;
      createdAt: string;
    };

export type PublicEvent = PublicEventBody & PublicEventChain;

export interface PublicDispute {
  text: string | null;
  textStatus: 'public' | 'held' | 'removed';
  holdReason: HoldReason | null;
  createdAt: string;
}

/** Public fields are deliberately separate from the private record type. */
export interface PublicTraceRecord {
  id: string;
  caseNumber?: string;
  municipalityId: string;
  category: string | PilotConfigEntity;
  office: string | PilotConfigEntity;
  status: 'answered' | 'resolved' | 'disputed';
  commitment: string;
  dueDate: string;
  signedBy: OfficialSignature;
  evidenceNote: string | null;
  evidenceUrls: string[];
  publishedAt: string;
  resolvedAt: string | null;
  disputes: PublicDispute[];
  events: PublicEvent[];
  receiptHash: string;
  /** The hash of the last public event: the head of the chain the receipt covers. */
  lastEventHash?: string;
  /** sha256 of the text as filed, and which hash it is. */
  textSha256?: string;
  textHashKind?: TextHashKind;
  /** The section of the office that holds the case. */
  unit?: { id: string; name: LocalizedName } | null;
  /** The channel the report came in on. */
  origin?: TraceOrigin;
  testEnvironment: true;
}

export function officialProfileFromResponse(value: unknown): OfficialProfile {
  if (!value || typeof value !== 'object') throw new Error('invalid_official_profile_response');
  const body = value as Record<string, unknown>;
  const profile = (body.profile && typeof body.profile === 'object' ? body.profile : body) as
    Record<string, unknown>;
  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  const title = typeof profile.title === 'string' ? profile.title.trim() : '';
  if (!name || !title) throw new Error('invalid_official_profile_response');
  const unit = profile.unit && typeof profile.unit === 'object'
    ? (profile.unit as { id?: unknown; name?: unknown })
    : null;
  return {
    citizenId: typeof profile.citizenId === 'string' ? profile.citizenId : '',
    name,
    title,
    unit: unit && typeof unit.id === 'string'
      ? { id: unit.id, name: (unit.name ?? {}) as LocalizedName }
      : null,
  };
}

export function isPilotRole(value: unknown): value is PilotRole {
  return value === 'resident' || value === 'official';
}

export function isTraceStatus(value: unknown): value is TraceStatus {
  return (
    value === 'open' ||
    value === 'assigned' ||
    value === 'answered' ||
    value === 'resolved' ||
    value === 'disputed' ||
    value === 'closed'
  );
}
export function pilotConfigFromResponse(value: unknown): PilotConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_config_response');
  }
  const config = value as Partial<PilotConfig>;
  const publicTextMode =
    config.publicTextMode === 'release' || config.publicTextMode === 'shell'
      ? config.publicTextMode
      : 'open';
  const publicTextRetentionDays =
    typeof config.publicTextRetentionDays === 'number' &&
    Number.isInteger(config.publicTextRetentionDays) &&
    config.publicTextRetentionDays >= 30
      ? config.publicTextRetentionDays
      : 730;
  return {
    ...config,
    publicTextMode,
    publicTextRetentionDays,
  } as PilotConfig;
}

export function recordFromEnvelope(value: unknown): PrivateTraceRecord {
  if (!value || typeof value !== 'object' || !('record' in value)) throw new Error('invalid_record_response');
  const record = (value as { record?: unknown }).record;
  if (!record || typeof record !== 'object') throw new Error('invalid_record_response');
  return record as PrivateTraceRecord;
}

export function publicRecordFromEnvelope(value: unknown): PublicTraceRecord {
  if (!value || typeof value !== 'object' || !('record' in value))
    throw new Error('invalid_public_record_response');
  const record = value.record;
  if (!record || typeof record !== 'object') throw new Error('invalid_public_record_response');
  const caseNumber =
    'caseNumber' in record &&
    typeof record.caseNumber === 'string' &&
    record.caseNumber.trim().length > 0
      ? record.caseNumber
      : undefined;
  return { ...(record as PublicTraceRecord), caseNumber };
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
export function eraseResultFromEnvelope(value: unknown): { case: PublicCaseShell } {
  const shell = envelopeMember(value, 'case', 'invalid_erase_response');
  if (!shell || typeof shell !== 'object') throw new Error('invalid_erase_response');
  return { case: shell as PublicCaseShell };
}

export function noticeResultFromEnvelope(value: unknown): { case: PublicCaseShell } {
  const shell = envelopeMember(value, 'case', 'invalid_notice_response');
  if (!shell || typeof shell !== 'object') throw new Error('invalid_notice_response');
  return { case: shell as PublicCaseShell };
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
  notFixedCount: number;
} {
  const counts = envelopeMember(value, 'counts', 'invalid_attention_response');
  if (!counts || typeof counts !== 'object') throw new Error('invalid_attention_response');
  const shape = counts as {
    followerCount?: unknown;
    alsoAffectedCount?: unknown;
    notFixedCount?: unknown;
  };
  if (
    typeof shape.followerCount !== 'number' ||
    typeof shape.alsoAffectedCount !== 'number' ||
    typeof shape.notFixedCount !== 'number'
  ) {
    throw new Error('invalid_attention_response');
  }
  return {
    followerCount: shape.followerCount,
    alsoAffectedCount: shape.alsoAffectedCount,
    notFixedCount: shape.notFixedCount,
  };
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

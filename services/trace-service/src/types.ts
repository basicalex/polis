// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from 'node:http';

export const TRACE_STATUSES = [
  'open',
  'assigned',
  'answered',
  'resolved',
  'disputed',
  'closed',
] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];
export type TraceRole = 'resident' | 'official' | 'gateway' | 'system';
export type TraceStage = 'voice' | 'responsibility' | 'response' | 'check' | 'receipt';
export type TraceOrigin = 'web' | 'sms' | 'voice';
export type FilerKind = 'account' | 'anonymous-channel';
export type ClosedReason =
  | 'duplicate'
  | 'out-of-scope'
  | 'withdrawn'
  | 'insufficient-information'
  | 'no-action-possible'
  | 'resolved-elsewhere';
export const SHELL_STATES = [
  'received',
  'assigned',
  'answered',
  'resolved',
  'disputed',
  'closed',
] as const;
export type ShellState = (typeof SHELL_STATES)[number];
export type PublicTextMode = 'open' | 'release' | 'shell';
export const ASSESSMENT_HOLD_REASONS = ['personal-data', 'abuse', 'off-topic', 'other'] as const;
export type AssessmentHoldReason = (typeof ASSESSMENT_HOLD_REASONS)[number];
export type HoldReason =
  AssessmentHoldReason | 'pending-release' | 'policy' | 'notices' | 'confidential';
export type TextStatus = 'public' | 'held' | 'redacted' | 'removed';
export type RemovedReason = 'filer' | 'retention';

export interface Actor {
  id: string;
  email: string | null;
  role: TraceRole;
  recordScope?: string;
}

export interface LocalizedText {
  hr: string;
  it: string;
  en: string;
}
export interface TraceUnit {
  id: string;
  name: LocalizedText;
}

export interface OfficialProfile {
  citizenId: string;
  name: string;
  title: string;
  unit: TraceUnit;
}


export interface PilotSource {
  id: string;
  title: string;
  url: string;
  retrievedAt: string;
  supports: string[];
}

export interface PilotConfig {
  id: 'vrsar-orsera';
  testEnvironment: true;
  publicTextMode: PublicTextMode;
  publicTextRetentionDays: number;
  municipality: {
    id: 'vrsar-orsera';
    name: LocalizedText;
    caseNumber?: { prefix: string };
  };
  category: { id: 'public-lighting'; name: LocalizedText };
  office: {
    id: 'communal-system';
    name: LocalizedText;
    routingStatus: string;
    units: TraceUnit[];
  };
  sources: PilotSource[];
}

export interface TraceConfig {
  internalApiToken: string;
  databaseUrl: string;
  intakeOpen: boolean;
  officialIds: ReadonlySet<string>;
  gatewayIds?: ReadonlySet<string>;
  attentionPepper?: string;
  aiIntakeUrl?: string | null;
  aiComplianceUrl?: string | null;
  holdTerms?: string[];
  confidentialTerms?: string[];
  retentionIntervalMinutes?: number;
  caseNumberPrefix?: string;
  pilot: PilotConfig;
}

export interface ParsedTraceConfig extends TraceConfig {
  gatewayIds: ReadonlySet<string>;
  attentionPepper: string;
  aiIntakeUrl: string | null;
  aiComplianceUrl: string | null;
  holdTerms: string[];
  confidentialTerms: string[];
  retentionIntervalMinutes: number;
  caseNumberPrefix: string;
  pilot: PilotConfig & {
    municipality: PilotConfig['municipality'] & {
      caseNumber: { prefix: string };
    };
  };
}

export interface PrivateEvent {
  id: string;
  sequence: number;
  stage: TraceStage;
  action: string;
  actorRole: TraceRole;
  note: string | null;
  createdAt: string;
  previousHash: string | null;
  hash: string;
}

export type PublicEventData =
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
      unit: TraceUnit | null;
      createdAt: string;
    }
  | {
      stage: 'response';
      action: 'commitment-published';
      actorRole: 'official';
      signedBy: { name: string; title: string };
      createdAt: string;
    }
  | {
      stage: 'check';
      action: 'completion-reported';
      actorRole: 'official';
      signedBy: { name: string; title: string };
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

export type PublicEvent = PublicEventData & {
  previousHash: string;
  hash: string;
};

export interface AttachmentMetadata {
  id: string;
  filename: string;
  contentType: string;
  byteCount: number;
  sha256: string;
  createdAt: string;
}

export interface PrivateRecord {
  id: string;
  municipalityId: string;
  category: string;
  status: TraceStatus;
  version: number;
  subject: string;
  narrative: string;
  location: string;
  contactEmail: string | null;
  office: string;
  signedBy: { name: string; title: string } | null;
  commitment: string | null;
  dueDate: string | null;
  evidenceNote: string | null;
  evidenceUrls: string[];
  createdAt: string;
  updatedAt: string;
  events: PrivateEvent[];
  attachments: AttachmentMetadata[];
  caseNumber: string;
  origin: TraceOrigin;
  filerKind: FilerKind;
  closedReason: ClosedReason | null;
  closedPublicReason: string | null;
  followerCount: number;
  alsoAffectedCount: number;
  notFixedCount: number;
  disputeCount: number;
  aiProposals: AiProposal[];
}

export interface PublicRecord {
  id: string;
  caseNumber: string;
  municipalityId: string;
  category: string;
  office: string;
  status: 'answered' | 'resolved' | 'disputed';
  commitment: string;
  dueDate: string;
  signedBy: { name: string; title: string };
  unit: TraceUnit | null;
  textSha256: string;
  textHashKind: 'raw' | 'normalized-legacy';
  evidenceNote: string | null;
  evidenceUrls: string[];
  publishedAt: string;
  resolvedAt: string | null;
  disputes: Array<{
    text: string | null;
    textStatus: TextStatus;
    holdReason: HoldReason | null;
    createdAt: string;
  }>;
  events: PublicEvent[];
  lastEventHash: string;
  receiptHash: string;
  testEnvironment: true;
}

export interface CaseShell {
  caseNumber: string;
  municipalityId: string;
  area: string;
  category: string;
  track: 'standard';
  state: ShellState;
  text: string | null;
  location: string | null;
  textStatus: TextStatus;
  holdReason: HoldReason | null;
  removedReason: RemovedReason | null;
  textHashKind: 'raw' | 'normalized-legacy';
  unitId: string | null;
  textSha256: string;
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

export type CaseMessageDirection = 'inbound' | 'outbound';
export type CaseMessageKind =
  | 'append'
  | 'label-appeal'
  | 'dispute'
  | 'answer'
  | 'question'
  | 'status-update'
  | 'receipt'
  | 'transcript'
  | 'transcript-failed'
  | 'notice';
export type CaseMessageSource = 'typed' | 'transcript' | 'system';
export type CaseMessageAuthorKind = 'filer' | 'official' | 'system';
export type CaseMessageDeliveryState =
  'pending' | 'handed-off' | 'delivered' | 'failed' | 'not-applicable';

export interface CaseMessage {
  id: string;
  recordId: string;
  direction: CaseMessageDirection;
  kind: CaseMessageKind;
  channel: TraceOrigin;
  source: CaseMessageSource;
  body: string;
  bodySha256: string;
  noticeReason: HoldReason | null;
  authorKind: CaseMessageAuthorKind;
  authorActorId: string | null;
  inReplyTo: string | null;
  deliveryState: CaseMessageDeliveryState;
  deliveryFailureCode: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export type AiProposalKind = 'category' | 'location' | 'duplicate-of' | 'office';
export type AiProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';

export interface AiProposal {
  id: string;
  recordId: string;
  kind: AiProposalKind;
  proposedValue: Record<string, unknown>;
  confidence: number;
  modelId: string;
  modelVersion: string;
  promptSha256: string;
  aiTraceId: string | null;
  aiOutputId: string | null;
  status: AiProposalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface FilerCaseView {
  caseNumber: string;
  state: ShellState;
  category: string;
  office: string;
  location: string;
  narrative: string;
  clockDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: CaseMessage[];
  events: Array<Omit<PrivateEvent, 'note'>>;
  attachments: AttachmentMetadata[];
  shell: CaseShell;
}

export interface RecordRow {
  id: string;
  municipality_id: string;
  category: string;
  office: string;
  owner_actor_id: string | null;
  case_number: string;
  origin: TraceOrigin;
  filer_kind: FilerKind;
  gateway_actor_id: string | null;
  reopen_key_hash: string | null;
  reopen_key_version: number;
  duplicate_of_record_id: string | null;
  closed_reason: ClosedReason | null;
  closed_note: string | null;
  closed_public_reason: string | null;
  follower_count: number;
  also_affected_count: number;
  not_fixed_count: number;
  dispute_count: number;
  notice_count: number;
  status: TraceStatus;
  version: number;
  commitment: string | null;
  due_date: string | null;
  evidence_note: string | null;
  evidence_urls: string[] | null;
  text_status: TextStatus;
  hold_reason: HoldReason | null;
  removed_reason: RemovedReason | null;
  text_normalized_sha256: string;
  text_hash_kind: 'raw' | 'normalized-legacy';
  unit_id: string | null;
  text_sha256: string;
  redacted_text: string | null;
  labels: string[];
  signed_by_name: string | null;
  signed_by_title: string | null;
  terminal_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CommandContext {
  actor: Actor;
  method: string;
  path: string;
  idempotencyKey: string;
  normalizedBody: Record<string, unknown>;
}

export interface AttachmentDownload {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface GatewayCreateInput {
  channel: TraceOrigin;
  text: string | null;
  location?: string;
  source: CaseMessageSource;
  occurredAt: string;
  attachment?: {
    filename: string;
    contentType: 'image/jpeg' | 'image/png';
    base64: string;
  };
}

export interface GatewayMessageInput {
  channel: TraceOrigin;
  kind: Extract<CaseMessageKind, 'append' | 'transcript' | 'transcript-failed'>;
  text: string | null;
  source: CaseMessageSource;
  occurredAt: string;
}

export interface ReopenReadInput {
  caseNumber: string;
  reopenKey: string;
}

export interface FilerMessageInput {
  kind?: 'append' | 'label-appeal';
  body: string;
  inReplyTo?: string;
}

export interface OfficialMessageInput {
  kind: Extract<CaseMessageKind, 'answer' | 'question' | 'status-update'>;
  body: string;
  channel: TraceOrigin | null;
  inReplyTo?: string | null;
}

export interface AiProposalInput {
  kind: AiProposalKind;
  proposedValue: Record<string, unknown>;
  confidence: number;
  modelId: string;
  modelVersion: string;
  promptSha256: string;
  aiTraceId?: string;
  aiOutputId?: string;
}

export interface AiDecisionInput {
  decision: Extract<AiProposalStatus, 'accepted' | 'rejected'>;
  note?: string;
}

export interface CloseInput {
  reason: ClosedReason;
  note?: string;
  publicReason: string;
}

export interface CommitmentInput {
  expectedVersion: number;
  commitment: string;
  dueDate: string;
}

export interface ResolutionInput {
  expectedVersion: number;
  evidenceNote: string;
  evidenceUrls: string[];
}

export interface HoldInput {
  reason: HoldReason;
  note?: string;
}

export interface ReleaseInput {
  redactedText?: string;
  note?: string;
}

export interface LabelInput {
  label: 'form-letter';
  action: 'set' | 'clear';
}

export interface ReopenInput {
  note?: string;
}

export interface DisputeInput {
  reopenKey: string;
  text: string;
}

export interface EraseTextInput {
  reopenKey: string;
}

export interface NoticeInput {
  followerKey: string;
  reason: AssessmentHoldReason;
  note?: string;
}

export interface AttentionInput {
  followerKey: string;
  kind: 'follow' | 'also-affected' | 'not-fixed';
  action: 'add' | 'remove';
}
export interface PublicCaseCursor {
  updatedAt: string;
  caseNumber: string;
}

export interface PublicCaseListQuery {
  limit: number;
  state: ShellState | null;
  cursor: PublicCaseCursor | null;
}

export interface PublicCaseSummary {
  total: number;
  byState: Record<ShellState, number>;
  open: number;
  overdue: number;
  held: number;
  pendingRelease: number;
  removed: number;
  computedAt: string;
}

export interface OfficialProfileInput {
  name: string;
  title: string;
  unitId: string;
}


export interface TraceStore {
  check(): Promise<void>;
  listPrivate(actor: Actor, limit: number): Promise<PrivateRecord[]>;
  getPrivate(actor: Actor, id: string): Promise<PrivateRecord | null>;
  create(ctx: CommandContext): Promise<{ status: number; body: unknown }>;
  assign(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  commitment(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  resolution(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  reopen(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  hold(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  release(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  label(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  addAttachment(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  downloadAttachment(
    actor: Actor,
    recordId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload | null>;
  listPublic(limit: number): Promise<PublicRecord[]>;
  getPublic(id: string): Promise<PublicRecord | null>;
  createChannelCase(
    ctx: CommandContext,
    input: GatewayCreateInput,
  ): Promise<{
    case: { recordId: string; caseNumber: string; reopenKey: string; state: ShellState };
    shell: CaseShell;
  }>;
  appendChannelMessage(
    ctx: CommandContext,
    caseNumber: string,
    input: GatewayMessageInput,
  ): Promise<{ message: CaseMessage }>;
  listOutbox(ctx: CommandContext, limit: number): Promise<{ messages: CaseMessage[] }>;
  markOutboxDelivery(
    ctx: CommandContext,
    messageId: string,
    input: { state: CaseMessageDeliveryState; failureCode?: string },
  ): Promise<{ message: CaseMessage }>;
  readFilerCase(caseNumber: string, reopenKey: string): Promise<{ case: FilerCaseView }>;
  appendFilerMessage(
    caseNumber: string,
    reopenKey: string,
    input: FilerMessageInput,
  ): Promise<{ message: CaseMessage }>;
  dispute(
    caseNumber: string,
    input: DisputeInput,
  ): Promise<{ case: CaseShell; record: PublicRecord }>;
  eraseText(
    caseNumber: string,
    input: EraseTextInput,
    ctx: CommandContext,
  ): Promise<{ case: CaseShell }>;
  listMessages(ctx: CommandContext, recordId: string): Promise<{ messages: CaseMessage[] }>;
  postOfficialMessage(
    ctx: CommandContext,
    recordId: string,
    input: OfficialMessageInput,
  ): Promise<{ message: CaseMessage; record: PrivateRecord }>;
  proposeAi(
    ctx: CommandContext,
    recordId: string,
    input: AiProposalInput,
  ): Promise<{ proposal: AiProposal }>;
  decideAi(
    ctx: CommandContext,
    recordId: string,
    proposalId: string,
    input: AiDecisionInput,
  ): Promise<{ proposal: AiProposal; record: PrivateRecord }>;
  closeCase(
    ctx: CommandContext,
    recordId: string,
    input: CloseInput,
  ): Promise<{ record: PrivateRecord; shell: CaseShell }>;
  listPublicShells(
    query: PublicCaseListQuery,
  ): Promise<{ cases: CaseShell[]; nextCursor: string | null }>;
  listPublicSummary(): Promise<PublicCaseSummary>;
  getPublicCase(
    caseNumber: string,
  ): Promise<{ case: CaseShell; record: PublicRecord | null } | null>;
  upsertOfficial(
    actor: Actor,
    citizenId: string,
    input: OfficialProfileInput,
  ): Promise<OfficialProfile>;
  getOfficial(actor: Actor): Promise<OfficialProfile | null>;
  recordAttention(
    caseNumber: string,
    input: AttentionInput,
  ): Promise<{
    counts: { followerCount: number; alsoAffectedCount: number; notFixedCount: number };
  }>;
  recordNotice(
    caseNumber: string,
    input: NoticeInput,
    ctx: CommandContext,
  ): Promise<{ case: CaseShell }>;
  close(): Promise<void>;
}

export type RequestLike = Pick<IncomingMessage, 'headers' | 'url'>;

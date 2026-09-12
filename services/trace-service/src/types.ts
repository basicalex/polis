// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from 'node:http';

export const TRACE_STATUSES = [
  'open',
  'assigned',
  'commitment-pending-review',
  'returned',
  'published',
  'resolution-pending-review',
  'resolved',
  'closed',
] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];
export type TraceRole = 'resident' | 'official' | 'reviewer' | 'gateway';
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
export type ShellState = 'received' | 'assigned' | 'in-review' | 'published' | 'resolved' | 'closed';

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
  municipality: {
    id: 'vrsar-orsera';
    name: LocalizedText;
    caseNumber?: { prefix: string; start: number };
  };
  category: { id: 'public-lighting'; name: LocalizedText };
  office: { id: 'communal-system'; name: LocalizedText; routingStatus: string };
  sources: PilotSource[];
}

export interface TraceConfig {
  internalApiToken: string;
  databaseUrl: string;
  intakeOpen: boolean;
  officialIds: ReadonlySet<string>;
  reviewerIds: ReadonlySet<string>;
  gatewayIds?: ReadonlySet<string>;
  attentionPepper?: string;
  aiIntakeUrl?: string | null;
  caseNumberPrefix?: string;
  caseNumberStart?: number;
  pilot: PilotConfig;
}

export interface ParsedTraceConfig extends TraceConfig {
  gatewayIds: ReadonlySet<string>;
  attentionPepper: string;
  aiIntakeUrl: string | null;
  caseNumberPrefix: string;
  caseNumberStart: number;
  pilot: PilotConfig & {
    municipality: PilotConfig['municipality'] & {
      caseNumber: { prefix: string; start: number };
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

export type PublicEvent =
  | {
      stage: 'voice';
      action: 'report-filed';
      actorRole: 'resident';
      createdAt: string;
    }
  | {
      stage: 'responsibility';
      action: 'office-assigned';
      actorRole: 'official';
      createdAt: string;
    }
  | {
      stage: 'response';
      action: 'commitment-filed';
      actorRole: 'official';
      createdAt: string;
    }
  | {
      stage: 'check';
      action: 'commitment-accepted';
      actorRole: 'reviewer';
      createdAt: string;
    }
  | {
      stage: 'receipt';
      action: 'published';
      actorRole: 'reviewer';
      createdAt: string;
    }
  | {
      stage: 'receipt';
      action: 'completion-approved';
      actorRole: 'reviewer';
      createdAt: string;
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
  publicSummary: string | null;
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
  aiProposals: AiProposal[];
}

export interface PublicRecord {
  id: string;
  municipalityId: string;
  category: string;
  office: string;
  status: 'published' | 'resolved';
  publicSummary: string;
  commitment: string;
  dueDate: string;
  evidenceNote: string | null;
  evidenceUrls: string[];
  publishedAt: string;
  resolvedAt: string | null;
  events: PublicEvent[];
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
  closedPublicReason: string | null;
  filedAt: string;
  clockDueAt: string | null;
  followerCount: number;
  alsoAffectedCount: number;
  shellHash: string;
  updatedAt: string;
  testEnvironment: true;
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

export interface CaseMessage {
  id: string;
  recordId: string;
  direction: CaseMessageDirection;
  kind: CaseMessageKind;
  channel: TraceOrigin;
  source: CaseMessageSource;
  body: string;
  bodySha256: string;
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
  status: TraceStatus;
  version: number;
  public_summary: string | null;
  commitment: string | null;
  due_date: string | null;
  evidence_note: string | null;
  evidence_urls: string[] | null;
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
  body: string;
  inReplyTo?: string;
}

export interface OfficialMessageInput {
  kind: Extract<CaseMessageKind, 'answer' | 'question' | 'status-update'>;
  body: string;
  channel: TraceOrigin;
  inReplyTo?: string;
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

export interface AttentionInput {
  followerKey: string;
  kind: 'follow' | 'also-affected';
  action: 'add' | 'remove';
}

export interface TraceStore {
  check(): Promise<void>;
  listPrivate(actor: Actor, limit: number): Promise<PrivateRecord[]>;
  getPrivate(actor: Actor, id: string): Promise<PrivateRecord | null>;
  create(ctx: CommandContext): Promise<{ status: number; body: unknown }>;
  assign(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  commitment(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  review(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  resolution(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
  resolutionReview(ctx: CommandContext, id: string): Promise<{ status: number; body: unknown }>;
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
  listOutbox(
    ctx: CommandContext,
    limit: number,
  ): Promise<{ messages: CaseMessage[] }>;
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
  listMessages(
    ctx: CommandContext,
    recordId: string,
  ): Promise<{ messages: CaseMessage[] }>;
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
  listPublicShells(limit: number): Promise<{ cases: CaseShell[] }>;
  getPublicCase(
    caseNumber: string,
  ): Promise<{ case: CaseShell; record: PublicRecord | null } | null>;
  recordAttention(
    caseNumber: string,
    input: AttentionInput,
  ): Promise<{ counts: { followerCount: number; alsoAffectedCount: number } }>;
  close(): Promise<void>;
}

export type RequestLike = Pick<IncomingMessage, 'headers' | 'url'>;

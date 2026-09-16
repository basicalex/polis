// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';

import {
  canonicalJson,
  computeEventHash,
  computeReceiptHash,
  computeShellHash,
  sha256,
  verifyEventChain,
  verifyReceiptHash,
  type EventHashMaterial,
  type StoredEvent,
} from './canonical.js';
import {
  DomainError,
  assertExpectedVersion,
  canCloseCase,
  canReadPrivate,
  canUpload,
  reopenKeyHash,
  requireRole,
  requireTransition,
  shellStateFor,
  transitionAllowed,
} from './domain.js';
import { requestAiIntake as fetchAiIntake } from './ai-client.js';
import { assessText } from './compliance.js';
import type {
  Actor,
  AiDecisionInput,
  AiProposal,
  AiProposalInput,
  AttachmentDownload,
  AttachmentMetadata,
  AttentionInput,
  CaseMessage,
  CaseMessageAuthorKind,
  CaseMessageDeliveryState,
  CaseMessageDirection,
  CaseMessageKind,
  CaseMessageSource,
  CaseShell,
  CloseInput,
  CommandContext,
  DisputeInput,
  FilerCaseView,
  FilerMessageInput,
  GatewayCreateInput,
  GatewayMessageInput,
  HoldReason,
  OfficialMessageInput,
  PrivateEvent,
  PrivateRecord,
  PublicEvent,
  PublicRecord,
  RecordRow,
  ShellState,
  TextStatus,
  TraceConfig,
  TraceOrigin,
  TraceRole,
  TraceStage,
  TraceStatus,
  TraceStore,
} from './types.js';

interface PrivateMaterialRow {
  subject: string;
  narrative: string;
  location: string;
  contact_email: string | null;
}

interface EventRow {
  id: string;
  record_id: string;
  sequence: number;
  previous_hash: string | null;
  hash: string;
  stage: TraceStage;
  action: string;
  actor_id: string;
  actor_role: TraceRole;
  note: string | null;
  payload: Record<string, unknown>;
  resulting_version: number;
  resulting_status: TraceStatus;
  created_at: Date | string;
}

interface PublicEventSourceRow {
  sequence: number;
  stage: TraceStage;
  action: string;
  actor_role: TraceRole;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  content?: Uint8Array;
  byte_count: number;
  sha256: string;
  created_at: Date | string;
}

interface IdempotencyRow {
  method: string;
  path: string;
  request_hash: string;
  record_id: string | null;
  response_status: number | null;
  response_body: unknown;
}

interface PublicSnapshotRow {
  record_id: string;
  municipality_id: string;
  category: string;
  office: string;
  public_status: 'answered' | 'resolved' | 'disputed';
  commitment: string;
  due_date: Date | string;
  signed_by_name: string | null;
  signed_by_title: string | null;
  evidence_note: string | null;
  evidence_urls: string[];
  published_at: Date | string;
  resolved_at: Date | string | null;
  disputes: PublicRecord['disputes'];
  public_events: PublicEvent[];
  receipt_hash: string;
}

interface CaseShellRow {
  record_id: string;
  case_number: string;
  municipality_id: string;
  area: string;
  category: string;
  track: 'standard';
  state: ShellState;
  text: string | null;
  location: string | null;
  text_status: TextStatus;
  hold_reason: HoldReason | null;
  text_sha256: string;
  labels: string[];
  closed_public_reason: string | null;
  filed_at: Date | string;
  clock_due_at: Date | string | null;
  follower_count: number;
  also_affected_count: number;
  not_fixed_count: number;
  dispute_count: number;
  shell_hash: string;
  updated_at: Date | string;
}

interface CaseMessageRow {
  id: string;
  record_id: string;
  direction: CaseMessageDirection;
  kind: CaseMessageKind;
  channel: TraceOrigin;
  source: CaseMessageSource;
  body: string;
  body_sha256: string;
  author_kind: CaseMessageAuthorKind;
  author_actor_id: string | null;
  in_reply_to: string | null;
  delivery_state: CaseMessageDeliveryState;
  delivery_failure_code: string | null;
  delivered_at: Date | string | null;
  created_at: Date | string;
}

interface AiProposalRow {
  id: string;
  record_id: string;
  kind: AiProposal['kind'];
  proposed_value: Record<string, unknown>;
  confidence: string | number;
  model_id: string;
  model_version: string;
  prompt_sha256: string;
  ai_trace_id: string | null;
  ai_output_id: string | null;
  status: AiProposal['status'];
  decided_by: string | null;
  decided_at: Date | string | null;
  decision_note: string | null;
  created_at: Date | string;
}

type ReopenResult = { record: RecordRow; actor: Actor } | { error: DomainError };

type RootSql = postgres.Sql;
type QuerySql = postgres.Sql | postgres.TransactionSql;
type CommandResult = { status: number; body: unknown };

const MAX_ATTACHMENTS_PER_RECORD = 20;
const MAX_EVENTS_PER_RECORD = 500;
const CASE_NUMBER_ATTEMPTS = 8;
const SYSTEM_ACTOR: Actor = { id: 'system:compliance', email: null, role: 'system' };

export async function generateRandomCaseNumber(
  tx: QuerySql,
  prefix: string,
  randomInteger: (min: number, max: number) => number = randomInt,
): Promise<string> {
  for (let attempt = 0; attempt < CASE_NUMBER_ATTEMPTS; attempt += 1) {
    const candidate = `${prefix}-${randomInteger(100_000, 1_000_000)}`;
    const rows = await tx<{ case_number: string }[]>`
      SELECT case_number FROM trace_records WHERE case_number = ${candidate} LIMIT 1
    `;
    if (!rows[0]) return candidate;
  }
  throw new DomainError(503, 'case_number_exhausted', 'Unable to allocate a case number.');
}

export interface TraceRepositoryOptions {
  afterPrivateRecordsSelected?: () => Promise<void>;
}

function integrityError(): DomainError {
  return new DomainError(503, 'trace_integrity_failed', 'Trace integrity verification failed.');
}

function jsonValue(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function privateEvent(row: EventRow): PrivateEvent {
  return {
    id: row.id,
    sequence: row.sequence,
    stage: row.stage,
    action: row.action,
    actorRole: row.actor_role,
    note: row.note,
    createdAt: iso(row.created_at),
    previousHash: row.previous_hash?.trim() ?? null,
    hash: row.hash.trim(),
  };
}

function storedEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    recordId: row.record_id,
    sequence: row.sequence,
    previousHash: row.previous_hash?.trim() ?? null,
    hash: row.hash.trim(),
    stage: row.stage,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    note: row.note,
    payload: row.payload,
    resultingVersion: row.resulting_version,
    resultingStatus: row.resulting_status,
    createdAt: iso(row.created_at),
  };
}

function attachmentMetadata(row: AttachmentRow): AttachmentMetadata {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    byteCount: row.byte_count,
    sha256: row.sha256.trim(),
    createdAt: iso(row.created_at),
  };
}

function publicRecord(row: PublicSnapshotRow): PublicRecord {
  if (!row.signed_by_name || !row.signed_by_title) throw integrityError();
  return {
    id: row.record_id,
    municipalityId: row.municipality_id,
    category: row.category,
    office: row.office,
    status: row.public_status,
    commitment: row.commitment,
    dueDate: dateOnly(row.due_date),
    signedBy: { name: row.signed_by_name, title: row.signed_by_title },
    evidenceNote: row.evidence_note,
    evidenceUrls: [...row.evidence_urls],
    publishedAt: iso(row.published_at),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    disputes: row.disputes.map((dispute) => ({ ...dispute })),
    events: row.public_events.map((event) => ({ ...event })),
    receiptHash: row.receipt_hash.trim(),
    testEnvironment: true,
  };
}

function verifiedPublicRecord(row: PublicSnapshotRow): PublicRecord {
  try {
    const record = publicRecord(row);
    if (!verifyReceiptHash(record)) throw integrityError();
    return record;
  } catch {
    throw integrityError();
  }
}

function caseShell(row: CaseShellRow): CaseShell {
  const shell: CaseShell = {
    caseNumber: row.case_number,
    municipalityId: row.municipality_id,
    area: row.area,
    category: row.category,
    track: row.track,
    state: row.state,
    text: row.text,
    location: row.location,
    textStatus: row.text_status,
    holdReason: row.hold_reason,
    textSha256: row.text_sha256.trim(),
    labels: [...row.labels],
    closedPublicReason: row.closed_public_reason,
    filedAt: iso(row.filed_at),
    clockDueAt: row.clock_due_at ? dateOnly(row.clock_due_at) : null,
    followerCount: row.follower_count,
    alsoAffectedCount: row.also_affected_count,
    notFixedCount: row.not_fixed_count,
    disputeCount: row.dispute_count,
    shellHash: row.shell_hash.trim(),
    updatedAt: iso(row.updated_at),
    testEnvironment: true,
  };
  if (computeShellHash(shell) !== shell.shellHash) throw integrityError();
  return shell;
}

function caseMessage(row: CaseMessageRow, redactActor = false): CaseMessage {
  return {
    id: row.id,
    recordId: row.record_id,
    direction: row.direction,
    kind: row.kind,
    channel: row.channel,
    source: row.source,
    body: row.body,
    bodySha256: row.body_sha256.trim(),
    authorKind: row.author_kind,
    authorActorId: redactActor ? null : row.author_actor_id,
    inReplyTo: row.in_reply_to,
    deliveryState: row.delivery_state,
    deliveryFailureCode: row.delivery_failure_code,
    deliveredAt: row.delivered_at ? iso(row.delivered_at) : null,
    createdAt: iso(row.created_at),
  };
}

function aiProposal(row: AiProposalRow): AiProposal {
  return {
    id: row.id,
    recordId: row.record_id,
    kind: row.kind,
    proposedValue: row.proposed_value,
    confidence: Number(row.confidence),
    modelId: row.model_id,
    modelVersion: row.model_version,
    promptSha256: row.prompt_sha256.trim(),
    aiTraceId: row.ai_trace_id,
    aiOutputId: row.ai_output_id,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? iso(row.decided_at) : null,
    decisionNote: row.decision_note,
    createdAt: iso(row.created_at),
  };
}

function errorForUnknownCase(): DomainError {
  return new DomainError(404, 'case_not_found', 'Case not found.');
}

function requestHash(ctx: CommandContext): string {
  return sha256(canonicalJson({ method: ctx.method, path: ctx.path, body: ctx.normalizedBody }));
}

function errorForUnknownRecord(): DomainError {
  return new DomainError(404, 'record_not_found', 'Record not found.');
}

export class TraceRepository implements TraceStore {
  readonly #sql: RootSql;
  readonly #intakeOpen: boolean;
  readonly #options: TraceRepositoryOptions;

  constructor(
    databaseUrl: string,
    readonly config: TraceConfig,
    options: TraceRepositoryOptions = {},
  ) {
    this.#sql = postgres(databaseUrl, { prepare: false, onnotice: () => undefined });
    this.#intakeOpen = config.intakeOpen;
    this.#options = options;
  }

  async check(): Promise<void> {
    const rows = await this.#sql<{ records: string | null; migrations: string | null }[]>`
      SELECT
        to_regclass('public.trace_records')::text AS records,
        to_regclass('public.trace_schema_migrations')::text AS migrations
    `;
    if (!rows[0]?.records || !rows[0]?.migrations) throw new Error('trace schema unavailable');
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }

  async listPrivate(actor: Actor, limit: number): Promise<PrivateRecord[]> {
    return this.#sql.begin('isolation level repeatable read read only', async (tx) => {
      const rows =
        actor.role === 'resident'
          ? await tx<RecordRow[]>`
              SELECT * FROM trace_records
              WHERE municipality_id = 'vrsar-orsera' AND owner_actor_id = ${actor.id}
              ORDER BY created_at DESC LIMIT ${limit}
            `
          : await tx<RecordRow[]>`
              SELECT * FROM trace_records
              WHERE municipality_id = 'vrsar-orsera'
              ORDER BY updated_at DESC LIMIT ${limit}
            `;
      await this.#options.afterPrivateRecordsSelected?.();
      return Promise.all(rows.map((row) => this.#loadPrivate(tx, row)));
    });
  }

  async getPrivate(actor: Actor, id: string): Promise<PrivateRecord | null> {
    return this.#sql.begin('isolation level repeatable read read only', async (tx) => {
      const rows = await tx<RecordRow[]>`SELECT * FROM trace_records WHERE id = ${id} LIMIT 1`;
      const row = rows[0];
      if (!row || !canReadPrivate(actor, row)) return null;
      await this.#options.afterPrivateRecordsSelected?.();
      return this.#loadPrivate(tx, row);
    });
  }

  async listPublic(limit: number): Promise<PublicRecord[]> {
    const rows = await this.#sql<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots ORDER BY updated_at DESC LIMIT ${limit}
    `;
    return rows.map(verifiedPublicRecord);
  }

  async getPublic(id: string): Promise<PublicRecord | null> {
    const rows = await this.#sql<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots WHERE record_id = ${id} LIMIT 1
    `;
    return rows[0] ? verifiedPublicRecord(rows[0]) : null;
  }

  async createChannelCase(
    ctx: CommandContext,
    input: GatewayCreateInput,
  ): Promise<{
    case: { recordId: string; caseNumber: string; reopenKey: string; state: ShellState };
    shell: CaseShell;
  }> {
    requireRole(ctx.actor, 'gateway');
    const outcome = await this.#sql.begin(async (tx) => {
      const replay = await this.#reserve(tx, ctx);
      if (replay) {
        const authorized = await this.#authorizedReplay(tx, ctx, replay);
        return {
          value: authorized.body as {
            case: {
              recordId: string;
              caseNumber: string;
              reopenKey: string;
              state: ShellState;
            };
            shell: CaseShell;
          },
          intake: null,
        };
      }
      if (!this.#intakeOpen) {
        throw new DomainError(503, 'intake_closed', 'New trace reports are temporarily closed.');
      }
      const now = new Date().toISOString();
      const recordId = randomUUID();
      const caseNumber = await this.#nextCaseNumber(tx);
      const issued = this.#issueReopenKey();
      const narrative = input.text ?? 'Glasovna prijava u obradi.';
      const subject = input.text ? input.text.slice(0, 200) : 'Glasovna prijava';
      const assessment = await this.#assessText(
        tx,
        narrative,
        input.location ?? null,
        this.config.pilot.municipality.id,
      );
      await tx`
        INSERT INTO trace_records (
          id, municipality_id, category, office, owner_actor_id, case_number, origin, filer_kind,
          gateway_actor_id, reopen_key_hash, status, version, commitment, due_date,
          evidence_note, evidence_urls, text_status, hold_reason, text_sha256, labels,
          created_at, updated_at
        ) VALUES (
          ${recordId}, 'vrsar-orsera', 'public-lighting', 'communal-system', NULL, ${caseNumber},
          ${input.channel}, 'anonymous-channel', ${ctx.actor.id}, ${issued.hash}, 'open', 0,
          NULL, NULL, NULL, ${tx.json(jsonValue([]))},
          ${assessment.hold ? 'held' : 'public'}, ${assessment.hold},
          ${assessment.normalizedSha256}, ${assessment.formLetter ? ['form-letter'] : []},
          ${now}, ${now}
        )
      `;
      await tx`
        INSERT INTO trace_report_private (record_id, subject, narrative, location, contact_email)
        VALUES (${recordId}, ${subject}, ${narrative}, ${input.location ?? ''}, NULL)
      `;
      const record = (
        await tx<RecordRow[]>`SELECT * FROM trace_records WHERE id = ${recordId}`
      )[0]!;
      const filer: Actor = {
        id: `anon:${recordId}`,
        email: null,
        role: 'resident',
        recordScope: recordId,
      };
      let current = record;
      await this.#appendEvent(
        tx,
        current,
        filer,
        'voice',
        'report-filed',
        null,
        { origin: input.channel, source: input.source, occurredAt: input.occurredAt },
        now,
      );
      if (assessment.hold) {
        await this.#appendEvent(
          tx,
          current,
          SYSTEM_ACTOR,
          'voice',
          'text-held',
          null,
          { reason: assessment.hold, signals: assessment.signals },
          now,
        );
      }
      if (assessment.formLetter) {
        await this.#appendEvent(
          tx,
          current,
          SYSTEM_ACTOR,
          'voice',
          'label-set',
          null,
          { label: 'form-letter', signals: assessment.signals },
          now,
        );
      }
      if (input.attachment) {
        const bytes = Buffer.from(input.attachment.base64, 'base64');
        const attachment: AttachmentMetadata = {
          id: randomUUID(),
          filename: input.attachment.filename,
          contentType: input.attachment.contentType,
          byteCount: bytes.byteLength,
          sha256: sha256(bytes),
          createdAt: now,
        };
        current = await this.#updateStatus(tx, current, current.status, now);
        await tx`
          INSERT INTO trace_attachments (
            id, record_id, filename, content_type, content, byte_count, sha256, created_by, created_at
          ) VALUES (
            ${attachment.id}, ${recordId}, ${attachment.filename}, ${attachment.contentType}, ${bytes},
            ${attachment.byteCount}, ${attachment.sha256}, ${ctx.actor.id}, ${now}
          )
        `;
        await this.#appendEvent(
          tx,
          current,
          ctx.actor,
          'voice',
          'attachment-added',
          null,
          {
            attachmentId: attachment.id,
            filename: attachment.filename,
            contentType: attachment.contentType,
            byteCount: attachment.byteCount,
            sha256: attachment.sha256,
          },
          now,
        );
      }
      const shell = await this.#writeShell(tx, current);
      const value = {
        case: { recordId, caseNumber, reopenKey: issued.key, state: shell.state },
        shell,
      };
      await this.#finish(tx, ctx, recordId, 201, value);
      return { value, intake: { recordId, text: narrative } };
    });
    if (outcome.intake) {
      await this.#requestAiIntake(outcome.intake.recordId, outcome.intake.text);
    }
    return outcome.value;
  }

  async appendChannelMessage(
    ctx: CommandContext,
    caseNumber: string,
    input: GatewayMessageInput,
  ): Promise<{ message: CaseMessage }> {
    requireRole(ctx.actor, 'gateway');
    const outcome = await this.#sql.begin(async (tx) => {
      const replay = await this.#reserve(tx, ctx);
      if (replay) {
        const authorized = await this.#authorizedReplay(tx, ctx, replay);
        return { value: authorized.body as { message: CaseMessage } };
      }
      const authenticated = await this.#authenticateReopen(
        tx,
        caseNumber,
        String(ctx.normalizedBody.reopenKey ?? ''),
      );
      if ('error' in authenticated) {
        await this.#discardReservation(tx, ctx);
        return { error: authenticated.error };
      }
      if (authenticated.record.gateway_actor_id !== ctx.actor.id) {
        await this.#discardReservation(tx, ctx);
        return { error: errorForUnknownCase() };
      }
      const message = await this.#appendMessage(tx, authenticated.record, authenticated.actor, {
        direction: 'inbound',
        kind: input.kind,
        channel: input.channel,
        source: input.source,
        body: input.text ?? '',
        inReplyTo: null,
        authorKind: 'filer',
        authorActorId: null,
        deliveryState: 'not-applicable',
        messageCreatedAt: input.occurredAt,
      });
      const value = { message };
      await this.#finish(tx, ctx, authenticated.record.id, 201, value);
      return { value };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  async listOutbox(ctx: CommandContext, limit: number): Promise<{ messages: CaseMessage[] }> {
    requireRole(ctx.actor, 'gateway');
    const rows = await this.#sql<CaseMessageRow[]>`
      SELECT messages.*
      FROM trace_case_messages AS messages
      JOIN trace_records AS records ON records.id = messages.record_id
      WHERE messages.direction = 'outbound'
        AND messages.delivery_state = 'pending'
        AND messages.channel IN ('sms', 'voice')
        AND records.gateway_actor_id = ${ctx.actor.id}
      ORDER BY messages.created_at, messages.id
      LIMIT ${limit}
    `;
    return { messages: rows.map((row) => caseMessage(row, true)) };
  }

  async markOutboxDelivery(
    ctx: CommandContext,
    messageId: string,
    input: { state: CaseMessageDeliveryState; failureCode?: string },
  ): Promise<{ message: CaseMessage }> {
    requireRole(ctx.actor, 'gateway');
    const result = await this.#sql.begin(async (tx) => {
      const replay = await this.#reserve(tx, ctx);
      if (replay) {
        const authorized = await this.#authorizedReplay(tx, ctx, replay);
        return authorized.body as { message: CaseMessage };
      }
      const rows = await tx<(CaseMessageRow & { gateway_actor_id: string | null })[]>`
        SELECT messages.*, records.gateway_actor_id
        FROM trace_case_messages AS messages
        JOIN trace_records AS records ON records.id = messages.record_id
        WHERE messages.id = ${messageId} AND messages.direction = 'outbound'
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current || current.gateway_actor_id !== ctx.actor.id) {
        throw new DomainError(404, 'message_not_found', 'Message not found.');
      }
      const deliveredAt = input.state === 'delivered' ? new Date().toISOString() : null;
      const updated = await tx<CaseMessageRow[]>`
        UPDATE trace_case_messages SET
          delivery_state = ${input.state},
          delivery_failure_code = ${input.failureCode ?? null},
          delivered_at = ${deliveredAt}
        WHERE id = ${messageId}
        RETURNING *
      `;
      const value = { message: caseMessage(updated[0]!, true) };
      await this.#finish(tx, ctx, current.record_id, 200, value);
      return value;
    });
    return result;
  }

  async readFilerCase(caseNumber: string, reopenKey: string): Promise<{ case: FilerCaseView }> {
    const outcome = await this.#sql.begin(async (tx) => {
      const authenticated = await this.#authenticateReopen(tx, caseNumber, reopenKey);
      if ('error' in authenticated) return { error: authenticated.error };
      return { value: { case: await this.#loadFilerCase(tx, authenticated.record) } };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  async appendFilerMessage(
    caseNumber: string,
    reopenKey: string,
    input: FilerMessageInput,
  ): Promise<{ message: CaseMessage }> {
    const outcome = await this.#sql.begin(async (tx) => {
      const authenticated = await this.#authenticateReopen(tx, caseNumber, reopenKey);
      if ('error' in authenticated) return { error: authenticated.error };
      const message = await this.#appendMessage(tx, authenticated.record, authenticated.actor, {
        direction: 'inbound',
        kind: input.kind ?? 'append',
        channel: authenticated.record.origin,
        source: 'typed',
        body: input.body,
        inReplyTo: input.inReplyTo ?? null,
        authorKind: 'filer',
        authorActorId: null,
        deliveryState: 'not-applicable',
      });
      return { value: { message } };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  async dispute(
    caseNumber: string,
    input: DisputeInput,
  ): Promise<{ case: CaseShell; record: PublicRecord }> {
    const outcome = await this.#sql.begin(async (tx) => {
      const authenticated = await this.#authenticateReopen(tx, caseNumber, input.reopenKey);
      if ('error' in authenticated) return { error: authenticated.error };
      const record = authenticated.record;
      requireTransition(transitionAllowed('dispute', record.status));
      if (record.dispute_count >= 3) {
        throw new DomainError(409, 'dispute_limit', 'This case has reached its dispute limit.');
      }
      const assessment = await this.#assessText(tx, input.text, null, record.municipality_id);
      const now = new Date().toISOString();
      const next = (
        await tx<RecordRow[]>`
          UPDATE trace_records SET
            status = 'disputed',
            dispute_count = dispute_count + 1,
            version = version + 1,
            updated_at = ${now}
          WHERE id = ${record.id}
          RETURNING *
        `
      )[0]!;
      await tx`
        INSERT INTO trace_case_messages (
          id, record_id, direction, kind, channel, source, body, body_sha256, author_kind,
          author_actor_id, in_reply_to, delivery_state, created_at
        ) VALUES (
          ${randomUUID()}, ${record.id}, 'inbound', 'dispute', ${record.origin}, 'typed',
          ${input.text}, ${sha256(input.text)}, 'filer', NULL, NULL, 'not-applicable', ${now}
        )
      `;
      await this.#appendEvent(
        tx,
        next,
        authenticated.actor,
        'check',
        'completion-disputed',
        null,
        {
          textSha256: assessment.normalizedSha256,
          textStatus: assessment.hold ? 'held' : 'public',
          holdReason: assessment.hold,
          signals: assessment.signals,
        },
        now,
      );
      const dispute = {
        text: assessment.hold ? null : input.text,
        textStatus: assessment.hold ? ('held' as const) : ('public' as const),
        holdReason: assessment.hold,
        createdAt: now,
      };
      const publicRecord = await this.#disputeSnapshot(tx, next, dispute, now);
      return {
        value: {
          case: await this.#writeShell(tx, next),
          record: publicRecord,
        },
      };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  async listMessages(ctx: CommandContext, recordId: string): Promise<{ messages: CaseMessage[] }> {
    requireRole(ctx.actor, 'official');
    const records = await this.#sql<RecordRow[]>`
      SELECT * FROM trace_records WHERE id = ${recordId} LIMIT 1
    `;
    const record = records[0];
    if (!record || !canReadPrivate(ctx.actor, record)) throw errorForUnknownRecord();
    return { messages: await this.#loadMessages(this.#sql, recordId) };
  }

  async postOfficialMessage(
    ctx: CommandContext,
    recordId: string,
    input: OfficialMessageInput,
  ): Promise<{ message: CaseMessage; record: PrivateRecord }> {
    const result = await this.#recordCommand(ctx, recordId, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      const channel = input.channel ?? record.origin;
      const message = await this.#appendMessage(tx, record, ctx.actor, {
        direction: 'outbound',
        kind: input.kind,
        channel,
        source: 'typed',
        body: input.body,
        inReplyTo: input.inReplyTo ?? null,
        authorKind: 'official',
        authorActorId: ctx.actor.id,
        deliveryState: channel === 'web' ? 'not-applicable' : 'pending',
      });
      const next = (await tx<RecordRow[]>`SELECT * FROM trace_records WHERE id = ${recordId}`)[0]!;
      await this.#markOfficial(tx, recordId, ctx.actor.id);
      return {
        status: 201,
        body: { message, record: await this.#loadPrivate(tx, next) },
      };
    });
    return result.body as { message: CaseMessage; record: PrivateRecord };
  }

  async proposeAi(
    ctx: CommandContext,
    recordId: string,
    input: AiProposalInput,
  ): Promise<{ proposal: AiProposal }> {
    const result = await this.#recordCommand(ctx, recordId, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      const proposal = await this.#proposeAi(tx, record.id, input);
      return { status: 201, body: { proposal } };
    });
    return result.body as { proposal: AiProposal };
  }

  async decideAi(
    ctx: CommandContext,
    recordId: string,
    proposalId: string,
    input: AiDecisionInput,
  ): Promise<{ proposal: AiProposal; record: PrivateRecord }> {
    const result = await this.#recordCommand(ctx, recordId, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      const decided = await this.#decideAi(tx, record, proposalId, input, ctx.actor);
      return {
        status: 200,
        body: {
          proposal: decided.proposal,
          record: await this.#loadPrivate(tx, decided.record),
        },
      };
    });
    return result.body as { proposal: AiProposal; record: PrivateRecord };
  }

  async closeCase(
    ctx: CommandContext,
    recordId: string,
    input: CloseInput,
  ): Promise<{ record: PrivateRecord; shell: CaseShell }> {
    const result = await this.#recordCommand(ctx, recordId, async (tx, record) => {
      const closed = await this.#closeCase(tx, record, input, ctx);
      return {
        status: 200,
        body: {
          record: await this.#loadPrivate(tx, closed.record),
          shell: closed.shell,
        },
      };
    });
    return result.body as { record: PrivateRecord; shell: CaseShell };
  }

  async listPublicShells(limit: number): Promise<{ cases: CaseShell[] }> {
    const rows = await this.#sql<CaseShellRow[]>`
      SELECT * FROM trace_case_shells ORDER BY updated_at DESC, case_number LIMIT ${limit}
    `;
    return { cases: rows.map(caseShell) };
  }

  async getPublicCase(
    caseNumber: string,
  ): Promise<{ case: CaseShell; record: PublicRecord | null } | null> {
    const shells = await this.#sql<CaseShellRow[]>`
      SELECT * FROM trace_case_shells WHERE case_number = ${caseNumber} LIMIT 1
    `;
    const shell = shells[0];
    if (!shell) return null;
    const snapshots = await this.#sql<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots WHERE record_id = ${shell.record_id} LIMIT 1
    `;
    return {
      case: caseShell(shell),
      record: snapshots[0] ? verifiedPublicRecord(snapshots[0]) : null,
    };
  }

  async recordAttention(
    caseNumber: string,
    input: AttentionInput,
  ): Promise<{
    counts: { followerCount: number; alsoAffectedCount: number; notFixedCount: number };
  }> {
    return this.#sql.begin((tx) => this.#recordAttention(tx, caseNumber, input));
  }

  async downloadAttachment(
    actor: Actor,
    recordId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload | null> {
    const records = await this.#sql<
      RecordRow[]
    >`SELECT * FROM trace_records WHERE id = ${recordId} LIMIT 1`;
    const record = records[0];
    if (!record || !canReadPrivate(actor, record)) return null;
    const rows = await this.#sql<AttachmentRow[]>`
      SELECT id, filename, content_type, content, byte_count, sha256, created_at
      FROM trace_attachments WHERE id = ${attachmentId} AND record_id = ${recordId} LIMIT 1
    `;
    const attachment = rows[0];
    if (!attachment?.content) return null;
    return {
      bytes: Uint8Array.from(attachment.content),
      filename: attachment.filename,
      contentType: attachment.content_type,
    };
  }

  async create(ctx: CommandContext): Promise<CommandResult> {
    requireRole(ctx.actor, 'resident');
    const outcome = await this.#sql.begin(async (tx) => {
      const replay = await this.#reserve(tx, ctx);
      if (replay) {
        return { result: await this.#authorizedReplay(tx, ctx, replay), intake: null };
      }
      if (!this.#intakeOpen) {
        throw new DomainError(503, 'intake_closed', 'New trace reports are temporarily closed.');
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      const caseNumber = await this.#nextCaseNumber(tx);
      const narrative = String(ctx.normalizedBody.narrative);
      const location = String(ctx.normalizedBody.location);
      const assessment = await this.#assessText(
        tx,
        narrative,
        location,
        this.config.pilot.municipality.id,
      );
      await tx`
        INSERT INTO trace_records (
          id, municipality_id, category, office, owner_actor_id, case_number, status, version,
          commitment, due_date, evidence_note, evidence_urls, text_status, hold_reason,
          text_sha256, labels, created_at, updated_at
        ) VALUES (
          ${id}, 'vrsar-orsera', 'public-lighting', 'communal-system', ${ctx.actor.id},
          ${caseNumber}, 'open', 0, NULL, NULL, NULL, ${tx.json(jsonValue([]))},
          ${assessment.hold ? 'held' : 'public'}, ${assessment.hold},
          ${assessment.normalizedSha256}, ${assessment.formLetter ? ['form-letter'] : []},
          ${now}, ${now}
        )
      `;
      await tx`
        INSERT INTO trace_report_private (record_id, subject, narrative, location, contact_email)
        VALUES (
          ${id}, ${String(ctx.normalizedBody.subject)}, ${narrative},
          ${location}, ${ctx.normalizedBody.contactEmail as string | null}
        )
      `;
      await tx`
        INSERT INTO trace_record_participants (record_id, actor_id, filed_report, acted_as_official)
        VALUES (${id}, ${ctx.actor.id}, true, false)
      `;
      const record = (await tx<RecordRow[]>`SELECT * FROM trace_records WHERE id = ${id}`)[0]!;
      await this.#appendEvent(
        tx,
        record,
        ctx.actor,
        'voice',
        'report-filed',
        null,
        ctx.normalizedBody,
        now,
      );
      if (assessment.hold) {
        await this.#appendEvent(
          tx,
          record,
          SYSTEM_ACTOR,
          'voice',
          'text-held',
          null,
          { reason: assessment.hold, signals: assessment.signals },
          now,
        );
      }
      if (assessment.formLetter) {
        await this.#appendEvent(
          tx,
          record,
          SYSTEM_ACTOR,
          'voice',
          'label-set',
          null,
          { label: 'form-letter', signals: assessment.signals },
          now,
        );
      }
      await this.#writeShell(tx, record);
      const body = { record: await this.#loadPrivate(tx, record) };
      return {
        result: await this.#finish(tx, ctx, id, 201, body),
        intake: { recordId: id, text: narrative },
      };
    });
    if (outcome.intake) {
      await this.#requestAiIntake(outcome.intake.recordId, outcome.intake.text);
    }
    return outcome.result;
  }

  async assign(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      requireTransition(transitionAllowed('assign', record.status));
      const now = new Date().toISOString();
      const next = await this.#updateStatus(tx, record, 'assigned', now);
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'responsibility',
        'record-assigned',
        null,
        {},
        now,
      );
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async commitment(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      requireTransition(transitionAllowed('commitment', record.status));
      const now = new Date().toISOString();
      const signedBy = ctx.normalizedBody.signedBy as { name: string; title: string };
      const rows = await tx<RecordRow[]>`
        UPDATE trace_records SET
          status = 'answered', version = version + 1,
          commitment = ${String(ctx.normalizedBody.commitment)},
          due_date = ${String(ctx.normalizedBody.dueDate)},
          signed_by_name = ${signedBy.name},
          signed_by_title = ${signedBy.title},
          updated_at = ${now}
        WHERE id = ${id} RETURNING *
      `;
      const next = rows[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'response',
        'commitment-published',
        null,
        {
          commitment: ctx.normalizedBody.commitment,
          dueDate: ctx.normalizedBody.dueDate,
          signedBy,
        },
        now,
      );
      await this.#publishSnapshot(tx, next, now);
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async resolution(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      requireTransition(transitionAllowed('resolution', record.status));
      const now = new Date().toISOString();
      const urls = ctx.normalizedBody.evidenceUrls as string[];
      const signedBy = ctx.normalizedBody.signedBy as { name: string; title: string };
      const rows = await tx<RecordRow[]>`
        UPDATE trace_records SET
          status = 'resolved', version = version + 1,
          evidence_note = ${String(ctx.normalizedBody.evidenceNote)},
          evidence_urls = ${tx.json(urls)},
          signed_by_name = ${signedBy.name},
          signed_by_title = ${signedBy.title},
          updated_at = ${now}
        WHERE id = ${id} RETURNING *
      `;
      const next = rows[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'check',
        'completion-reported',
        null,
        { evidenceNote: ctx.normalizedBody.evidenceNote, evidenceUrls: urls, signedBy },
        now,
      );
      await this.#appendEvent(
        tx,
        next,
        SYSTEM_ACTOR,
        'receipt',
        'case-resolved-standing',
        null,
        {},
        now,
      );
      await this.#resolveSnapshot(tx, next, now);
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async reopen(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      requireTransition(transitionAllowed('reopen', record.status));
      const now = new Date().toISOString();
      const next = await this.#updateStatus(tx, record, 'answered', now);
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'check',
        'case-reopened',
        (ctx.normalizedBody.note as string | null) ?? null,
        {},
        now,
      );
      await this.#reopenSnapshot(tx, next, now);
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async hold(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      if (record.status === 'closed') requireTransition(false);
      const reason = ctx.normalizedBody.reason as HoldReason;
      const now = new Date().toISOString();
      const next = (
        await tx<RecordRow[]>`
          UPDATE trace_records SET
            text_status = 'held', hold_reason = ${reason}, redacted_text = NULL,
            version = version + 1, updated_at = ${now}
          WHERE id = ${id} RETURNING *
        `
      )[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'voice',
        'text-held',
        (ctx.normalizedBody.note as string | null) ?? null,
        { reason },
        now,
      );
      await this.#refreshSnapshotEvents(tx, next, now);
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async release(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      if (record.status === 'closed') requireTransition(false);
      const redactedText = (ctx.normalizedBody.redactedText as string | null) ?? null;
      const now = new Date().toISOString();
      const next = (
        await tx<RecordRow[]>`
          UPDATE trace_records SET
            text_status = ${redactedText ? 'redacted' : 'public'},
            hold_reason = NULL,
            redacted_text = ${redactedText},
            version = version + 1,
            updated_at = ${now}
          WHERE id = ${id} RETURNING *
        `
      )[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'voice',
        'text-released',
        (ctx.normalizedBody.note as string | null) ?? null,
        { redacted: redactedText !== null },
        now,
      );
      await this.#refreshSnapshotEvents(tx, next, now);
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async label(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, _record) => {
      requireRole(ctx.actor, 'official');
      const action = ctx.normalizedBody.action as 'set' | 'clear';
      const labels = action === 'set' ? ['form-letter'] : [];
      const now = new Date().toISOString();
      const next = (
        await tx<RecordRow[]>`
          UPDATE trace_records SET
            labels = ${labels}, version = version + 1, updated_at = ${now}
          WHERE id = ${id} RETURNING *
        `
      )[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'voice',
        action === 'set' ? 'label-set' : 'label-cleared',
        null,
        { label: 'form-letter' },
        now,
      );
      await this.#refreshSnapshotEvents(tx, next, now);
      await this.#writeShell(tx, next);
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async addAttachment(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      if (!canUpload(ctx.actor, record)) {
        throw new DomainError(
          403,
          'forbidden',
          'Only the record owner or an official may upload attachments.',
        );
      }
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      const counts = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM trace_attachments WHERE record_id = ${id}
      `;
      if ((counts[0]?.count ?? 0) >= MAX_ATTACHMENTS_PER_RECORD) {
        throw new DomainError(
          409,
          'attachment_limit_reached',
          'This record has reached its private attachment limit.',
        );
      }
      const now = new Date().toISOString();
      const bytes = Buffer.from(String(ctx.normalizedBody.base64), 'base64');
      const attachment: AttachmentMetadata = {
        id: randomUUID(),
        filename: String(ctx.normalizedBody.filename),
        contentType: String(ctx.normalizedBody.contentType),
        byteCount: bytes.byteLength,
        sha256: sha256(bytes),
        createdAt: now,
      };
      const next = await this.#updateStatus(tx, record, record.status, now);
      await tx`
        INSERT INTO trace_attachments (
          id, record_id, filename, content_type, content, byte_count, sha256, created_by, created_at
        ) VALUES (
          ${attachment.id}, ${id}, ${attachment.filename}, ${attachment.contentType}, ${bytes},
          ${attachment.byteCount}, ${attachment.sha256}, ${ctx.actor.id}, ${now}
        )
      `;
      if (ctx.actor.role === 'official') await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'voice',
        'attachment-added',
        null,
        {
          attachmentId: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          byteCount: attachment.byteCount,
          sha256: attachment.sha256,
        },
        now,
      );
      return {
        status: 201,
        body: { record: await this.#loadPrivate(tx, next), attachment },
      };
    });
  }

  async #assessText(tx: QuerySql, text: string, location: string | null, municipalityId: string) {
    const rows = await tx<{ text_sha256: string }[]>`
      SELECT text_sha256
      FROM trace_records
      WHERE municipality_id = ${municipalityId}
        AND created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
    `;
    return assessText(
      {
        text,
        location,
        municipalityId,
        recentNarrativeHashes: rows.map((row) => row.text_sha256.trim()),
      },
      {
        gatewayUrl: this.config.aiComplianceUrl ?? null,
        holdTerms: this.config.holdTerms ?? [],
      },
    );
  }

  async #nextCaseNumber(tx: QuerySql): Promise<string> {
    const prefix =
      this.config.caseNumberPrefix ?? this.config.pilot.municipality.caseNumber?.prefix ?? 'VRS';
    return generateRandomCaseNumber(tx, prefix);
  }

  #issueReopenKey(): { key: string; hash: string } {
    const key = randomBytes(20).toString('base64url');
    return { key, hash: reopenKeyHash(key) };
  }

  async #discardReservation(tx: QuerySql, ctx: CommandContext): Promise<void> {
    await tx`
      DELETE FROM trace_command_idempotency
      WHERE actor_id = ${ctx.actor.id} AND idempotency_key = ${ctx.idempotencyKey}
    `;
  }

  async #authenticateReopen(tx: QuerySql, caseNumber: string, key: string): Promise<ReopenResult> {
    const attempts = await tx<{ attempts: number }[]>`
      INSERT INTO trace_reopen_attempts (case_number, window_start, attempts)
      VALUES (${caseNumber}, NOW(), 1)
      ON CONFLICT (case_number) DO UPDATE SET
        window_start = CASE
          WHEN trace_reopen_attempts.window_start <= NOW() - INTERVAL '15 minutes' THEN NOW()
          ELSE trace_reopen_attempts.window_start
        END,
        attempts = CASE
          WHEN trace_reopen_attempts.window_start <= NOW() - INTERVAL '15 minutes' THEN 1
          ELSE trace_reopen_attempts.attempts + 1
        END
      RETURNING attempts
    `;
    if (attempts[0]!.attempts > 5) {
      return {
        error: new DomainError(429, 'too_many_attempts', 'Too many reopen attempts.'),
      };
    }
    const records = await tx<RecordRow[]>`
      SELECT * FROM trace_records WHERE case_number = ${caseNumber} FOR UPDATE
    `;
    const record = records[0];
    const candidate = Buffer.from(reopenKeyHash(key), 'hex');
    const expected = Buffer.from(record?.reopen_key_hash?.trim() ?? '0'.repeat(64), 'hex');
    const matches = timingSafeEqual(candidate, expected);
    if (!record || record.filer_kind !== 'anonymous-channel' || !matches) {
      return { error: errorForUnknownCase() };
    }
    await tx`DELETE FROM trace_reopen_attempts WHERE case_number = ${caseNumber}`;
    return {
      record,
      actor: {
        id: `anon:${record.id}`,
        email: null,
        role: 'resident',
        recordScope: record.id,
      },
    };
  }

  async #loadMessages(sql: QuerySql, recordId: string): Promise<CaseMessage[]> {
    const rows = await sql<CaseMessageRow[]>`
      SELECT * FROM trace_case_messages
      WHERE record_id = ${recordId}
      ORDER BY created_at, id
    `;
    return rows.map((row) => caseMessage(row));
  }

  async #loadFilerCase(tx: QuerySql, record: RecordRow): Promise<FilerCaseView> {
    const privateRecord = await this.#loadPrivate(tx, record);
    const shellRows = await tx<CaseShellRow[]>`
      SELECT * FROM trace_case_shells WHERE record_id = ${record.id}
    `;
    const shell = shellRows[0];
    if (!shell) throw integrityError();
    return {
      caseNumber: record.case_number,
      state: shell.state,
      category: record.category,
      office: record.office,
      location: privateRecord.location,
      narrative: privateRecord.narrative,
      clockDueAt: record.due_date ? dateOnly(record.due_date) : null,
      createdAt: iso(record.created_at),
      updatedAt: iso(record.updated_at),
      messages: await this.#loadMessages(tx, record.id),
      events: privateRecord.events.map(({ note: _note, ...event }) => event),
      attachments: privateRecord.attachments,
      shell: caseShell(shell),
    };
  }

  async #appendMessage(
    tx: QuerySql,
    record: RecordRow,
    actor: Actor,
    input: {
      direction: CaseMessageDirection;
      kind: CaseMessageKind;
      channel: TraceOrigin;
      source: CaseMessageSource;
      body: string;
      inReplyTo: string | null;
      authorKind: CaseMessageAuthorKind;
      authorActorId: string | null;
      deliveryState: CaseMessageDeliveryState;
      messageCreatedAt?: string;
    },
  ): Promise<CaseMessage> {
    if (input.inReplyTo) {
      const replies = await tx<{ id: string }[]>`
        SELECT id FROM trace_case_messages
        WHERE id = ${input.inReplyTo} AND record_id = ${record.id}
      `;
      if (!replies[0]) throw new DomainError(404, 'message_not_found', 'Message not found.');
    }
    const now = new Date().toISOString();
    const next = (
      await tx<RecordRow[]>`
        UPDATE trace_records SET version = version + 1, updated_at = ${now}
        WHERE id = ${record.id} RETURNING *
      `
    )[0]!;
    if (input.kind === 'transcript' && input.body) {
      await tx`
        UPDATE trace_report_private SET narrative = ${input.body}
        WHERE record_id = ${record.id} AND narrative = 'Glasovna prijava u obradi.'
      `;
    }
    const row: CaseMessageRow = {
      id: randomUUID(),
      record_id: record.id,
      direction: input.direction,
      kind: input.kind,
      channel: input.channel,
      source: input.source,
      body: input.body,
      body_sha256: sha256(input.body),
      author_kind: input.authorKind,
      author_actor_id: input.authorActorId,
      in_reply_to: input.inReplyTo,
      delivery_state: input.deliveryState,
      delivery_failure_code: null,
      delivered_at: null,
      created_at: input.messageCreatedAt ?? now,
    };
    await tx`
      INSERT INTO trace_case_messages (
        id, record_id, direction, kind, channel, source, body, body_sha256, author_kind,
        author_actor_id, in_reply_to, delivery_state, delivery_failure_code, delivered_at, created_at
      ) VALUES (
        ${row.id}, ${row.record_id}, ${row.direction}, ${row.kind}, ${row.channel}, ${row.source},
        ${row.body}, ${row.body_sha256}, ${row.author_kind}, ${row.author_actor_id},
        ${row.in_reply_to}, ${row.delivery_state}, NULL, NULL, ${row.created_at as string}
      )
    `;
    await this.#appendEvent(
      tx,
      next,
      actor,
      'voice',
      'message-appended',
      null,
      { bodySha256: row.body_sha256, kind: row.kind },
      now,
    );
    return caseMessage(row);
  }

  async #writeShell(tx: QuerySql, record: RecordRow): Promise<CaseShell> {
    const materials = await tx<PrivateMaterialRow[]>`
      SELECT subject, narrative, location, contact_email
      FROM trace_report_private
      WHERE record_id = ${record.id}
    `;
    const material = materials[0];
    if (!material) throw integrityError();
    const held = record.text_status === 'held';
    const shellWithoutHash: Omit<CaseShell, 'shellHash'> = {
      caseNumber: record.case_number,
      municipalityId: record.municipality_id,
      area: 'vrsar-orsera',
      category: record.category,
      track: 'standard',
      state: shellStateFor(record.status),
      text: held
        ? null
        : record.text_status === 'redacted'
          ? record.redacted_text
          : material.narrative,
      location: held ? null : material.location,
      textStatus: record.text_status,
      holdReason: record.hold_reason,
      textSha256: record.text_sha256.trim(),
      labels: [...record.labels].sort(),
      closedPublicReason: record.closed_public_reason,
      filedAt: iso(record.created_at),
      clockDueAt: record.due_date ? dateOnly(record.due_date) : null,
      followerCount: record.follower_count,
      alsoAffectedCount: record.also_affected_count,
      notFixedCount: record.not_fixed_count,
      disputeCount: record.dispute_count,
      updatedAt: iso(record.updated_at),
      testEnvironment: true,
    };
    const shell: CaseShell = {
      ...shellWithoutHash,
      shellHash: computeShellHash(shellWithoutHash),
    };
    await tx`
      INSERT INTO trace_case_shells (
        record_id, case_number, municipality_id, area, category, track, state,
        text, location, text_status, hold_reason, text_sha256, labels,
        closed_public_reason, filed_at, clock_due_at, follower_count, also_affected_count,
        not_fixed_count, dispute_count, shell_hash, updated_at
      ) VALUES (
        ${record.id}, ${shell.caseNumber}, ${shell.municipalityId}, ${shell.area}, ${shell.category},
        ${shell.track}, ${shell.state}, ${shell.text}, ${shell.location}, ${shell.textStatus},
        ${shell.holdReason}, ${shell.textSha256}, ${shell.labels}, ${shell.closedPublicReason},
        ${shell.filedAt}, ${shell.clockDueAt}, ${shell.followerCount},
        ${shell.alsoAffectedCount}, ${shell.notFixedCount}, ${shell.disputeCount},
        ${shell.shellHash}, ${shell.updatedAt}
      )
      ON CONFLICT (record_id) DO UPDATE SET
        case_number = EXCLUDED.case_number,
        municipality_id = EXCLUDED.municipality_id,
        area = EXCLUDED.area,
        category = EXCLUDED.category,
        track = EXCLUDED.track,
        state = EXCLUDED.state,
        text = EXCLUDED.text,
        location = EXCLUDED.location,
        text_status = EXCLUDED.text_status,
        hold_reason = EXCLUDED.hold_reason,
        text_sha256 = EXCLUDED.text_sha256,
        labels = EXCLUDED.labels,
        closed_public_reason = EXCLUDED.closed_public_reason,
        filed_at = EXCLUDED.filed_at,
        clock_due_at = EXCLUDED.clock_due_at,
        follower_count = EXCLUDED.follower_count,
        also_affected_count = EXCLUDED.also_affected_count,
        not_fixed_count = EXCLUDED.not_fixed_count,
        dispute_count = EXCLUDED.dispute_count,
        shell_hash = EXCLUDED.shell_hash,
        updated_at = EXCLUDED.updated_at
    `;
    return shell;
  }

  async #recordAttention(
    tx: QuerySql,
    caseNumber: string,
    input: AttentionInput,
  ): Promise<{
    counts: { followerCount: number; alsoAffectedCount: number; notFixedCount: number };
  }> {
    const records = await tx<RecordRow[]>`
      SELECT * FROM trace_records WHERE case_number = ${caseNumber} FOR UPDATE
    `;
    const record = records[0];
    if (!record) throw errorForUnknownCase();
    if (
      input.kind === 'not-fixed' &&
      record.status !== 'resolved' &&
      record.status !== 'disputed'
    ) {
      requireTransition(false);
    }
    if (!this.config.attentionPepper) throw new Error('trace attention pepper unavailable');
    const subjectHash = sha256(input.followerKey + caseNumber + this.config.attentionPepper);
    if (input.action === 'add') {
      await tx`
        INSERT INTO trace_case_attention (record_id, subject_hash, kind, created_at)
        VALUES (${record.id}, ${subjectHash}, ${input.kind}, NOW())
        ON CONFLICT DO NOTHING
      `;
    } else {
      await tx`
        DELETE FROM trace_case_attention
        WHERE record_id = ${record.id} AND subject_hash = ${subjectHash} AND kind = ${input.kind}
      `;
    }
    const counts = await tx<
      { follower_count: number; also_affected_count: number; not_fixed_count: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE kind = 'follow')::int AS follower_count,
        count(*) FILTER (WHERE kind = 'also-affected')::int AS also_affected_count,
        count(*) FILTER (WHERE kind = 'not-fixed')::int AS not_fixed_count
      FROM trace_case_attention WHERE record_id = ${record.id}
    `;
    const count = counts[0]!;
    const now = new Date().toISOString();
    const updated = (
      await tx<RecordRow[]>`
        UPDATE trace_records SET
          follower_count = ${count.follower_count},
          also_affected_count = ${count.also_affected_count},
          not_fixed_count = ${count.not_fixed_count},
          updated_at = ${now}
        WHERE id = ${record.id}
        RETURNING *
      `
    )[0]!;
    await this.#writeShell(tx, updated);
    return {
      counts: {
        followerCount: count.follower_count,
        alsoAffectedCount: count.also_affected_count,
        notFixedCount: count.not_fixed_count,
      },
    };
  }

  async #proposeAi(tx: QuerySql, recordId: string, input: AiProposalInput): Promise<AiProposal> {
    const now = new Date().toISOString();
    const rows = await tx<AiProposalRow[]>`
      INSERT INTO trace_ai_proposals (
        id, record_id, kind, proposed_value, confidence, model_id, model_version,
        prompt_sha256, ai_trace_id, ai_output_id, status, created_at
      ) VALUES (
        ${randomUUID()}, ${recordId}, ${input.kind}, ${tx.json(jsonValue(input.proposedValue))},
        ${input.confidence}, ${input.modelId}, ${input.modelVersion}, ${input.promptSha256},
        ${input.aiTraceId ?? null}, ${input.aiOutputId ?? null}, 'proposed', ${now}
      )
      RETURNING *
    `;
    return aiProposal(rows[0]!);
  }

  async #decideAi(
    tx: QuerySql,
    record: RecordRow,
    proposalId: string,
    input: AiDecisionInput,
    actor: Actor,
  ): Promise<{ proposal: AiProposal; record: RecordRow }> {
    const proposals = await tx<AiProposalRow[]>`
      SELECT * FROM trace_ai_proposals
      WHERE id = ${proposalId} AND record_id = ${record.id}
      FOR UPDATE
    `;
    const proposal = proposals[0];
    if (!proposal) throw new DomainError(404, 'ai_proposal_not_found', 'AI proposal not found.');
    if (proposal.status !== 'proposed') {
      throw new DomainError(409, 'ai_proposal_decided', 'AI proposal was already decided.');
    }
    if (input.decision === 'accepted') {
      if (proposal.kind === 'category') {
        if (proposal.proposed_value.category !== this.config.pilot.category.id) {
          throw new DomainError(
            409,
            'category_not_allowed',
            'The proposed category is not allowed.',
          );
        }
        await tx`
          UPDATE trace_records SET category = ${String(proposal.proposed_value.category)}
          WHERE id = ${record.id}
        `;
      } else if (proposal.kind === 'location') {
        await tx`
          UPDATE trace_report_private SET location = ${String(proposal.proposed_value.locationText)}
          WHERE record_id = ${record.id}
        `;
      } else if (proposal.kind === 'office') {
        await tx`
          UPDATE trace_records SET office = ${String(proposal.proposed_value.office)}
          WHERE id = ${record.id}
        `;
      } else {
        const duplicateId = String(proposal.proposed_value.caseId);
        const duplicates = await tx<{ id: string }[]>`
          SELECT id FROM trace_records WHERE id = ${duplicateId}
        `;
        if (duplicateId === record.id || !duplicates[0]) {
          throw new DomainError(
            409,
            'duplicate_not_allowed',
            'The proposed duplicate target is not allowed.',
          );
        }
        await tx`
          UPDATE trace_records SET duplicate_of_record_id = ${duplicateId}
          WHERE id = ${record.id}
        `;
      }
    }
    const now = new Date().toISOString();
    const next = (
      await tx<RecordRow[]>`
        UPDATE trace_records SET version = version + 1, updated_at = ${now}
        WHERE id = ${record.id}
        RETURNING *
      `
    )[0]!;
    const decidedRows = await tx<AiProposalRow[]>`
      UPDATE trace_ai_proposals SET
        status = ${input.decision},
        decided_by = ${actor.id},
        decided_at = ${now},
        decision_note = ${input.note ?? null}
      WHERE id = ${proposal.id}
      RETURNING *
    `;
    await this.#appendEvent(
      tx,
      next,
      actor,
      'check',
      input.decision === 'accepted' ? 'ai-proposal-accepted' : 'ai-proposal-rejected',
      input.note ?? null,
      { proposalId: proposal.id, kind: proposal.kind },
      now,
    );
    await this.#writeShell(tx, next);
    return { proposal: aiProposal(decidedRows[0]!), record: next };
  }

  async #closeCase(
    tx: QuerySql,
    record: RecordRow,
    input: CloseInput,
    ctx: CommandContext,
  ): Promise<{ record: RecordRow; shell: CaseShell }> {
    requireRole(ctx.actor, 'official');
    assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
    requireTransition(canCloseCase(record.status));
    const now = new Date().toISOString();
    const next = (
      await tx<RecordRow[]>`
        UPDATE trace_records SET
          status = 'closed',
          version = version + 1,
          closed_reason = ${input.reason},
          closed_note = ${input.note ?? null},
          closed_public_reason = ${input.publicReason},
          updated_at = ${now}
        WHERE id = ${record.id}
        RETURNING *
      `
    )[0]!;
    await this.#markOfficial(tx, record.id, ctx.actor.id);
    await this.#appendEvent(
      tx,
      next,
      ctx.actor,
      record.status === 'open' ? 'voice' : 'responsibility',
      'case-closed',
      input.note ?? null,
      { reason: input.reason, publicReason: input.publicReason },
      now,
    );
    await tx`DELETE FROM trace_public_snapshots WHERE record_id = ${record.id}`;
    return { record: next, shell: await this.#writeShell(tx, next) };
  }

  async #requestAiIntake(recordId: string, text: string): Promise<void> {
    if (!this.config.aiIntakeUrl) return;
    try {
      const knownOpenCases = await this.#sql<{ id: string; category: string; narrative: string }[]>`
        SELECT records.id, records.category, private.narrative
        FROM trace_records AS records
        JOIN trace_report_private AS private ON private.record_id = records.id
        WHERE records.municipality_id = ${this.config.pilot.municipality.id}
          AND records.status NOT IN ('resolved', 'closed')
          AND records.id <> ${recordId}
        ORDER BY records.created_at DESC
        LIMIT 50
      `;
      // Raw narrative leaves trace-service only while every shipped profile pins AI_MODE=stub.
      const result = await fetchAiIntake(this.config.aiIntakeUrl, {
        caseId: recordId,
        text,
        municipalityId: this.config.pilot.municipality.id,
        language: 'hr',
        knownOpenCases: knownOpenCases.map((record) => ({
          caseId: record.id,
          category: record.category,
          locationText: '',
          summary: record.narrative.slice(0, 200),
        })),
      });
      if (result.status === 'skipped') return;
      if (result.status === 'blocked') {
        console.error(
          JSON.stringify({
            service: 'trace-service',
            stage: 'ai-intake',
            warning: 'ai_intake_blocked',
          }),
        );
        return;
      }
      const response = result.proposal;
      if (
        typeof response.confidence !== 'number' ||
        !Number.isFinite(response.confidence) ||
        response.confidence < 0 ||
        response.confidence > 1
      ) {
        throw new Error('ai_intake_invalid_response');
      }
      const common = {
        confidence: response.confidence,
        modelId: 'ai-gateway/case-intake-v1',
        modelVersion: '0.1',
        promptSha256: sha256(text),
        aiTraceId: typeof response.traceId === 'string' ? response.traceId : undefined,
        aiOutputId: typeof response.outputId === 'string' ? response.outputId : undefined,
      };
      const inputs: AiProposalInput[] = [];
      if (typeof response.category === 'string' && response.category.trim()) {
        inputs.push({
          ...common,
          kind: 'category',
          proposedValue: { category: response.category.trim() },
        });
      }
      if (typeof response.locationText === 'string' && response.locationText.trim()) {
        inputs.push({
          ...common,
          kind: 'location',
          proposedValue: { locationText: response.locationText.trim() },
        });
      }
      if (typeof response.duplicateOf === 'string' && response.duplicateOf) {
        inputs.push({
          ...common,
          kind: 'duplicate-of',
          proposedValue: { caseId: response.duplicateOf },
        });
      }
      if (typeof response.office === 'string' && response.office.trim()) {
        inputs.push({
          ...common,
          kind: 'office',
          proposedValue: { office: response.office.trim() },
        });
      }
      if (inputs.length === 0) return;
      await this.#sql.begin(async (tx) => {
        for (const input of inputs) await this.#proposeAi(tx, recordId, input);
      });
    } catch {
      console.error(
        JSON.stringify({
          service: 'trace-service',
          stage: 'ai-intake',
          warning: 'ai_intake_failed',
        }),
      );
    }
  }

  async #recordCommand(
    ctx: CommandContext,
    id: string,
    operation: (tx: QuerySql, record: RecordRow) => Promise<CommandResult>,
  ): Promise<CommandResult> {
    return this.#sql.begin(async (tx) => {
      const replay = await this.#reserve(tx, ctx);
      if (replay) return this.#authorizedReplay(tx, ctx, replay);
      const rows = await tx<RecordRow[]>`SELECT * FROM trace_records WHERE id = ${id} FOR UPDATE`;
      const record = rows[0];
      if (!record || !canReadPrivate(ctx.actor, record)) throw errorForUnknownRecord();
      const result = await operation(tx, record);
      return this.#finish(tx, ctx, id, result.status, result.body);
    });
  }

  async #reserve(tx: QuerySql, ctx: CommandContext): Promise<IdempotencyRow | null> {
    const hash = requestHash(ctx);
    const inserted = await tx<{ actor_id: string }[]>`
      INSERT INTO trace_command_idempotency (
        actor_id, idempotency_key, method, path, request_hash, created_at
      ) VALUES (${ctx.actor.id}, ${ctx.idempotencyKey}, ${ctx.method}, ${ctx.path}, ${hash}, NOW())
      ON CONFLICT DO NOTHING RETURNING actor_id
    `;
    if (inserted.length > 0) return null;
    const rows = await tx<IdempotencyRow[]>`
      SELECT method, path, request_hash, record_id, response_status, response_body
      FROM trace_command_idempotency
      WHERE actor_id = ${ctx.actor.id} AND idempotency_key = ${ctx.idempotencyKey}
      FOR UPDATE
    `;
    const existing = rows[0];
    if (!existing) throw new Error('idempotency reservation disappeared');
    if (
      existing.method !== ctx.method ||
      existing.path !== ctx.path ||
      existing.request_hash.trim() !== hash
    ) {
      throw new DomainError(
        409,
        'idempotency_conflict',
        'The idempotency key was used for a different request.',
      );
    }
    if (existing.response_status === null || existing.response_body === null) {
      throw new Error('incomplete idempotency result');
    }
    return existing;
  }

  async #authorizedReplay(
    tx: QuerySql,
    ctx: CommandContext,
    replay: IdempotencyRow,
  ): Promise<CommandResult> {
    if (!replay.record_id) throw errorForUnknownRecord();
    const rows = await tx<RecordRow[]>`
      SELECT * FROM trace_records WHERE id = ${replay.record_id} FOR UPDATE
    `;
    const record = rows[0];
    if (!record || !canReadPrivate(ctx.actor, record)) throw errorForUnknownRecord();
    if (ctx.path.endsWith('/attachments')) {
      if (!canUpload(ctx.actor, record)) {
        throw new DomainError(
          403,
          'forbidden',
          'Only the record owner or an official may upload attachments.',
        );
      }
    } else if (
      ctx.path === '/internal/trace/channel/cases' ||
      ctx.path.startsWith('/internal/trace/channel/cases/') ||
      ctx.path.startsWith('/internal/trace/channel/outbox/')
    ) {
      requireRole(ctx.actor, 'gateway');
    } else if (
      ctx.path.endsWith('/close') ||
      ctx.path.endsWith('/messages') ||
      ctx.path.includes('/ai-proposals')
    ) {
      requireRole(ctx.actor, 'official');
    } else if (ctx.path !== '/internal/trace/records') {
      requireRole(ctx.actor, 'official');
    } else {
      requireRole(ctx.actor, 'resident');
    }
    await this.#loadPrivate(tx, record);
    return { status: replay.response_status!, body: replay.response_body };
  }

  async #finish(
    tx: QuerySql,
    ctx: CommandContext,
    recordId: string,
    status: number,
    body: unknown,
  ): Promise<CommandResult> {
    await tx`
      UPDATE trace_command_idempotency
      SET record_id = ${recordId}, response_status = ${status}, response_body = ${tx.json(jsonValue(body))}
      WHERE actor_id = ${ctx.actor.id} AND idempotency_key = ${ctx.idempotencyKey}
    `;
    return { status, body };
  }

  async #updateStatus(
    tx: QuerySql,
    record: RecordRow,
    status: TraceStatus,
    now: string,
  ): Promise<RecordRow> {
    const rows = await tx<RecordRow[]>`
      UPDATE trace_records SET status = ${status}, version = version + 1, updated_at = ${now}
      WHERE id = ${record.id} RETURNING *
    `;
    return rows[0]!;
  }

  async #markOfficial(tx: QuerySql, recordId: string, actorId: string): Promise<void> {
    await tx`
      INSERT INTO trace_record_participants (record_id, actor_id, filed_report, acted_as_official)
      VALUES (${recordId}, ${actorId}, false, true)
      ON CONFLICT (record_id, actor_id)
      DO UPDATE SET acted_as_official = true
    `;
  }

  async #appendEvent(
    tx: QuerySql,
    record: RecordRow,
    actor: Actor,
    stage: TraceStage,
    action: string,
    note: string | null,
    payload: Record<string, unknown>,
    createdAt: string,
  ): Promise<void> {
    const previous = await tx<{ sequence: number; hash: string }[]>`
      SELECT sequence, hash FROM trace_events
      WHERE record_id = ${record.id} ORDER BY sequence DESC LIMIT 1
    `;
    const latest = previous[0];
    if ((latest?.sequence ?? 0) >= MAX_EVENTS_PER_RECORD) {
      throw new DomainError(
        409,
        'event_limit_reached',
        'This record has reached its private event limit.',
      );
    }
    const material: EventHashMaterial = {
      id: randomUUID(),
      recordId: record.id,
      sequence: latest ? latest.sequence + 1 : 1,
      previousHash: latest?.hash.trim() ?? null,
      stage,
      action,
      actorId: actor.id,
      actorRole: actor.role,
      note,
      payload,
      resultingVersion: record.version,
      resultingStatus: record.status,
      createdAt,
    };
    const hash = computeEventHash(material);
    await tx`
      INSERT INTO trace_events (
        id, record_id, sequence, previous_hash, hash, stage, action, actor_id, actor_role,
        note, payload, resulting_version, resulting_status, created_at
      ) VALUES (
        ${material.id}, ${record.id}, ${material.sequence}, ${material.previousHash}, ${hash},
        ${stage}, ${action}, ${actor.id}, ${actor.role}, ${note}, ${tx.json(jsonValue(payload))},
        ${record.version}, ${record.status}, ${createdAt}
      )
    `;
  }

  async #publicMilestones(tx: QuerySql, record: RecordRow): Promise<PublicEvent[]> {
    const rows = await tx<PublicEventSourceRow[]>`
      SELECT sequence, stage, action, actor_role, payload, created_at
      FROM trace_events
      WHERE record_id = ${record.id}
      ORDER BY sequence
    `;
    const milestones: PublicEvent[] = [];
    for (const row of rows) {
      const createdAt = iso(row.created_at);
      if (
        (row.action === 'report-filed' || row.action === 'record-created') &&
        row.actor_role === 'resident'
      ) {
        milestones.push({
          stage: 'voice',
          action: 'report-filed',
          actorRole: 'resident',
          createdAt,
        });
      } else if (
        row.action === 'text-held' &&
        (row.actor_role === 'system' || row.actor_role === 'official')
      ) {
        milestones.push({
          stage: 'voice',
          action: 'text-held',
          actorRole: row.actor_role,
          reason: row.payload.reason as HoldReason,
          createdAt,
        });
      } else if (row.action === 'text-released' && row.actor_role === 'official') {
        milestones.push({
          stage: 'voice',
          action: 'text-released',
          actorRole: 'official',
          redacted: row.payload.redacted === true,
          createdAt,
        });
      } else if (
        (row.action === 'label-set' || row.action === 'label-cleared') &&
        (row.actor_role === 'system' || row.actor_role === 'official')
      ) {
        milestones.push({
          stage: 'voice',
          action: row.action,
          actorRole: row.actor_role,
          label: 'form-letter',
          createdAt,
        });
      } else if (row.action === 'record-assigned' && row.actor_role === 'official') {
        milestones.push({
          stage: 'responsibility',
          action: 'office-assigned',
          actorRole: 'official',
          createdAt,
        });
      } else if (row.action === 'commitment-published' && row.actor_role === 'official') {
        const signedBy = row.payload.signedBy as { name?: unknown } | undefined;
        milestones.push({
          stage: 'response',
          action: 'commitment-published',
          actorRole: 'official',
          signedBy: typeof signedBy?.name === 'string' ? signedBy.name : '',
          createdAt,
        });
      } else if (row.action === 'completion-reported' && row.actor_role === 'official') {
        milestones.push({
          stage: 'check',
          action: 'completion-reported',
          actorRole: 'official',
          createdAt,
        });
      } else if (row.action === 'completion-disputed' && row.actor_role === 'resident') {
        milestones.push({
          stage: 'check',
          action: 'completion-disputed',
          actorRole: 'resident',
          createdAt,
        });
      } else if (row.action === 'case-reopened' && row.actor_role === 'official') {
        milestones.push({
          stage: 'check',
          action: 'case-reopened',
          actorRole: 'official',
          createdAt,
        });
      } else if (row.action === 'case-resolved-standing' && row.actor_role === 'system') {
        milestones.push({
          stage: 'receipt',
          action: 'case-resolved-standing',
          actorRole: 'system',
          createdAt,
        });
      } else if (
        row.action === 'case-closed' &&
        row.actor_role === 'official' &&
        (row.stage === 'voice' || row.stage === 'responsibility')
      ) {
        milestones.push({
          stage: row.stage,
          action: 'case-closed',
          actorRole: 'official',
          publicReason: String(row.payload.publicReason),
          createdAt,
        });
      }
    }
    return milestones;
  }

  async #refreshSnapshotEvents(tx: QuerySql, record: RecordRow, now: string): Promise<void> {
    const rows = await tx<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots WHERE record_id = ${record.id} FOR UPDATE
    `;
    const prior = rows[0];
    if (!prior) return;
    const current = verifiedPublicRecord(prior);
    const events = await this.#publicMilestones(tx, record);
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      ...current,
      events,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      UPDATE trace_public_snapshots SET
        public_events = ${tx.json(jsonValue(events))},
        receipt_hash = ${receiptHash},
        updated_at = ${now}
      WHERE record_id = ${record.id}
    `;
  }

  async #publishSnapshot(tx: QuerySql, record: RecordRow, now: string): Promise<void> {
    if (
      !record.commitment ||
      !record.due_date ||
      !record.signed_by_name ||
      !record.signed_by_title
    ) {
      throw new Error('answered record is missing publication fields');
    }
    const events = await this.#publicMilestones(tx, record);
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      id: record.id,
      municipalityId: record.municipality_id,
      category: record.category,
      office: record.office,
      status: 'answered',
      commitment: record.commitment,
      dueDate: dateOnly(record.due_date),
      signedBy: { name: record.signed_by_name, title: record.signed_by_title },
      evidenceNote: null,
      evidenceUrls: [],
      publishedAt: now,
      resolvedAt: null,
      disputes: [],
      events,
      testEnvironment: true,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      INSERT INTO trace_public_snapshots (
        record_id, municipality_id, category, office, public_status, commitment,
        due_date, signed_by_name, signed_by_title, evidence_note, evidence_urls,
        published_at, resolved_at, disputes, public_events, receipt_hash, updated_at
      ) VALUES (
        ${record.id}, ${record.municipality_id}, ${record.category}, ${record.office}, 'answered',
        ${record.commitment}, ${dateOnly(record.due_date)}, ${record.signed_by_name},
        ${record.signed_by_title}, NULL, ${tx.json(jsonValue([]))}, ${now}, NULL,
        ${tx.json(jsonValue([]))}, ${tx.json(jsonValue(events))}, ${receiptHash}, ${now}
      )
      ON CONFLICT (record_id) DO UPDATE SET
        public_status = EXCLUDED.public_status,
        commitment = EXCLUDED.commitment,
        due_date = EXCLUDED.due_date,
        signed_by_name = EXCLUDED.signed_by_name,
        signed_by_title = EXCLUDED.signed_by_title,
        evidence_note = NULL,
        evidence_urls = '[]'::jsonb,
        published_at = EXCLUDED.published_at,
        resolved_at = NULL,
        disputes = '[]'::jsonb,
        public_events = EXCLUDED.public_events,
        receipt_hash = EXCLUDED.receipt_hash,
        updated_at = EXCLUDED.updated_at
    `;
  }

  async #resolveSnapshot(tx: QuerySql, record: RecordRow, now: string): Promise<void> {
    const rows = await tx<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots WHERE record_id = ${record.id} FOR UPDATE
    `;
    const prior = rows[0];
    if (!prior || !record.evidence_note || !record.signed_by_name || !record.signed_by_title) {
      throw new Error('resolution is missing an answered publication');
    }
    const answered = verifiedPublicRecord(prior);
    const events = await this.#publicMilestones(tx, record);
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      ...answered,
      status: 'resolved',
      signedBy: { name: record.signed_by_name, title: record.signed_by_title },
      evidenceNote: record.evidence_note,
      evidenceUrls: [...(record.evidence_urls ?? [])],
      resolvedAt: now,
      events,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      UPDATE trace_public_snapshots SET
        public_status = 'resolved',
        signed_by_name = ${record.signed_by_name},
        signed_by_title = ${record.signed_by_title},
        evidence_note = ${record.evidence_note},
        evidence_urls = ${tx.json(jsonValue(record.evidence_urls ?? []))},
        resolved_at = ${now},
        public_events = ${tx.json(jsonValue(events))},
        receipt_hash = ${receiptHash},
        updated_at = ${now}
      WHERE record_id = ${record.id}
    `;
  }

  async #reopenSnapshot(tx: QuerySql, record: RecordRow, now: string): Promise<void> {
    const rows = await tx<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots WHERE record_id = ${record.id} FOR UPDATE
    `;
    const prior = rows[0];
    if (!prior) throw new Error('reopen is missing a public record');
    const current = verifiedPublicRecord(prior);
    const events = await this.#publicMilestones(tx, record);
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      ...current,
      status: 'answered',
      resolvedAt: null,
      events,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      UPDATE trace_public_snapshots SET
        public_status = 'answered',
        resolved_at = NULL,
        public_events = ${tx.json(jsonValue(events))},
        receipt_hash = ${receiptHash},
        updated_at = ${now}
      WHERE record_id = ${record.id}
    `;
  }

  async #disputeSnapshot(
    tx: QuerySql,
    record: RecordRow,
    dispute: PublicRecord['disputes'][number],
    now: string,
  ): Promise<PublicRecord> {
    const rows = await tx<PublicSnapshotRow[]>`
      SELECT * FROM trace_public_snapshots WHERE record_id = ${record.id} FOR UPDATE
    `;
    const prior = rows[0];
    if (!prior) throw new Error('dispute is missing a resolved public record');
    const current = verifiedPublicRecord(prior);
    const events = await this.#publicMilestones(tx, record);
    const disputes = [...current.disputes, dispute];
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      ...current,
      status: 'disputed',
      disputes,
      events,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      UPDATE trace_public_snapshots SET
        public_status = 'disputed',
        disputes = ${tx.json(jsonValue(disputes))},
        public_events = ${tx.json(jsonValue(events))},
        receipt_hash = ${receiptHash},
        updated_at = ${now}
      WHERE record_id = ${record.id}
    `;
    return { ...snapshotWithoutHash, receiptHash };
  }

  async #loadPrivate(sql: QuerySql, record: RecordRow): Promise<PrivateRecord> {
    const materialRows = await sql<PrivateMaterialRow[]>`
      SELECT subject, narrative, location, contact_email
      FROM trace_report_private WHERE record_id = ${record.id}
    `;
    const eventRows = await sql<EventRow[]>`
      SELECT * FROM trace_events WHERE record_id = ${record.id} ORDER BY sequence
      LIMIT ${MAX_EVENTS_PER_RECORD + 1}
    `;
    const attachmentRows = await sql<AttachmentRow[]>`
      SELECT id, filename, content_type, byte_count, sha256, created_at
      FROM trace_attachments WHERE record_id = ${record.id} ORDER BY created_at
      LIMIT ${MAX_ATTACHMENTS_PER_RECORD + 1}
    `;
    const proposalRows = await sql<AiProposalRow[]>`
      SELECT * FROM trace_ai_proposals WHERE record_id = ${record.id} ORDER BY created_at, id
      LIMIT 200
    `;
    const material = materialRows[0];
    if (!material) throw integrityError();
    if (
      eventRows.length > MAX_EVENTS_PER_RECORD ||
      attachmentRows.length > MAX_ATTACHMENTS_PER_RECORD
    ) {
      throw integrityError();
    }
    const verification = verifyEventChain(eventRows.map(storedEvent), {
      version: record.version,
      status: record.status,
    });
    if (!verification.valid) throw integrityError();
    return {
      id: record.id,
      municipalityId: record.municipality_id,
      category: record.category,
      status: record.status,
      version: record.version,
      subject: material.subject,
      narrative: material.narrative,
      location: material.location,
      contactEmail: material.contact_email,
      office: record.office,
      signedBy:
        record.signed_by_name && record.signed_by_title
          ? { name: record.signed_by_name, title: record.signed_by_title }
          : null,
      commitment: record.commitment,
      dueDate: record.due_date ? dateOnly(record.due_date) : null,
      evidenceNote: record.evidence_note,
      evidenceUrls: [...(record.evidence_urls ?? [])],
      createdAt: iso(record.created_at),
      updatedAt: iso(record.updated_at),
      events: eventRows.map(privateEvent),
      attachments: attachmentRows.map(attachmentMetadata),
      caseNumber: record.case_number,
      origin: record.origin,
      filerKind: record.filer_kind,
      closedReason: record.closed_reason,
      closedPublicReason: record.closed_public_reason,
      followerCount: record.follower_count,
      alsoAffectedCount: record.also_affected_count,
      notFixedCount: record.not_fixed_count,
      disputeCount: record.dispute_count,
      aiProposals: proposalRows.map(aiProposal),
    };
  }
}

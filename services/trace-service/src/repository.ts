// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import {
  canonicalJson,
  computeEventHash,
  computeReceiptHash,
  sha256,
  verifyEventChain,
  verifyReceiptHash,
  type EventHashMaterial,
  type StoredEvent,
} from './canonical.js';
import {
  DomainError,
  assertExpectedVersion,
  canReadPrivate,
  canUpload,
  requireRole,
  requireTransition,
  transitionAllowed,
} from './domain.js';
import type {
  Actor,
  AttachmentDownload,
  AttachmentMetadata,
  CommandContext,
  PrivateEvent,
  PrivateRecord,
  PublicEvent,
  PublicRecord,
  RecordRow,
  TraceConfig,
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
  public_status: 'published' | 'resolved';
  public_summary: string;
  commitment: string;
  due_date: Date | string;
  evidence_note: string | null;
  evidence_urls: string[];
  published_at: Date | string;
  resolved_at: Date | string | null;
  public_events: PublicEvent[];
  receipt_hash: string;
}

type RootSql = postgres.Sql;
type QuerySql = postgres.Sql | postgres.TransactionSql;
type CommandResult = { status: number; body: unknown };

const MAX_ATTACHMENTS_PER_RECORD = 20;
const MAX_EVENTS_PER_RECORD = 500;

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
  return {
    id: row.record_id,
    municipalityId: row.municipality_id,
    category: row.category,
    office: row.office,
    status: row.public_status,
    publicSummary: row.public_summary,
    commitment: row.commitment,
    dueDate: dateOnly(row.due_date),
    evidenceNote: row.evidence_note,
    evidenceUrls: [...row.evidence_urls],
    publishedAt: iso(row.published_at),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
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
    return this.#sql.begin(async (tx) => {
      const replay = await this.#reserve(tx, ctx);
      if (replay) return this.#authorizedReplay(tx, ctx, replay);
      if (!this.#intakeOpen) {
        throw new DomainError(503, 'intake_closed', 'New trace reports are temporarily closed.');
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      await tx`
        INSERT INTO trace_records (
          id, municipality_id, category, office, owner_actor_id, status, version,
          public_summary, commitment, due_date, evidence_note, evidence_urls, created_at, updated_at
        ) VALUES (
          ${id}, 'vrsar-orsera', 'public-lighting', 'communal-system', ${ctx.actor.id}, 'open', 0,
          NULL, NULL, NULL, NULL, ${tx.json(jsonValue([]))}, ${now}, ${now}
        )
      `;
      await tx`
        INSERT INTO trace_report_private (record_id, subject, narrative, location, contact_email)
        VALUES (
          ${id}, ${String(ctx.normalizedBody.subject)}, ${String(ctx.normalizedBody.narrative)},
          ${String(ctx.normalizedBody.location)}, ${ctx.normalizedBody.contactEmail as string | null}
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
        'record-created',
        null,
        ctx.normalizedBody,
        now,
      );
      const body = { record: await this.#loadPrivate(tx, record) };
      return this.#finish(tx, ctx, id, 201, body);
    });
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
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async commitment(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'official');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      requireTransition(transitionAllowed('commitment', record.status));
      const now = new Date().toISOString();
      const rows = await tx<RecordRow[]>`
        UPDATE trace_records SET
          status = 'commitment-pending-review', version = version + 1,
          public_summary = ${String(ctx.normalizedBody.publicSummary)},
          commitment = ${String(ctx.normalizedBody.commitment)},
          due_date = ${String(ctx.normalizedBody.dueDate)}, updated_at = ${now}
        WHERE id = ${id} RETURNING *
      `;
      const next = rows[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'response',
        'commitment-submitted',
        null,
        {
          publicSummary: ctx.normalizedBody.publicSummary,
          commitment: ctx.normalizedBody.commitment,
          dueDate: ctx.normalizedBody.dueDate,
        },
        now,
      );
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async review(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'reviewer');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      const decision = String(ctx.normalizedBody.decision) as 'accept' | 'return';
      requireTransition(
        transitionAllowed(decision === 'accept' ? 'review-accept' : 'review-return', record.status),
      );
      await this.#assertIndependentReviewer(tx, id, ctx.actor.id);
      const now = new Date().toISOString();
      const next = await this.#updateStatus(
        tx,
        record,
        decision === 'accept' ? 'published' : 'returned',
        now,
      );
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'check',
        decision === 'accept' ? 'commitment-approved' : 'commitment-returned',
        ctx.normalizedBody.note as string | null,
        { decision },
        now,
      );
      if (decision === 'accept') await this.#publishSnapshot(tx, next, now);
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
      const rows = await tx<RecordRow[]>`
        UPDATE trace_records SET
          status = 'resolution-pending-review', version = version + 1,
          evidence_note = ${String(ctx.normalizedBody.evidenceNote)},
          evidence_urls = ${tx.json(urls)}, updated_at = ${now}
        WHERE id = ${id} RETURNING *
      `;
      const next = rows[0]!;
      await this.#markOfficial(tx, id, ctx.actor.id);
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'receipt',
        'resolution-submitted',
        null,
        { evidenceNote: ctx.normalizedBody.evidenceNote, evidenceUrls: urls },
        now,
      );
      return { status: 200, body: { record: await this.#loadPrivate(tx, next) } };
    });
  }

  async resolutionReview(ctx: CommandContext, id: string): Promise<CommandResult> {
    return this.#recordCommand(ctx, id, async (tx, record) => {
      requireRole(ctx.actor, 'reviewer');
      assertExpectedVersion(Number(ctx.normalizedBody.expectedVersion), record.version);
      const decision = String(ctx.normalizedBody.decision) as 'accept' | 'return';
      requireTransition(
        transitionAllowed(
          decision === 'accept' ? 'resolution-review-accept' : 'resolution-review-return',
          record.status,
        ),
      );
      await this.#assertIndependentReviewer(tx, id, ctx.actor.id);
      const now = new Date().toISOString();
      const next = await this.#updateStatus(
        tx,
        record,
        decision === 'accept' ? 'resolved' : 'published',
        now,
      );
      await this.#appendEvent(
        tx,
        next,
        ctx.actor,
        'receipt',
        decision === 'accept' ? 'resolution-approved' : 'resolution-returned',
        ctx.normalizedBody.note as string | null,
        { decision },
        now,
      );
      if (decision === 'accept') await this.#resolveSnapshot(tx, next, now);
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
    } else if (ctx.path.endsWith('/review') || ctx.path.endsWith('/resolution-review')) {
      requireRole(ctx.actor, 'reviewer');
      await this.#assertIndependentReviewer(tx, record.id, ctx.actor.id);
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

  async #assertIndependentReviewer(tx: QuerySql, recordId: string, actorId: string): Promise<void> {
    const rows = await tx<{ disqualified: boolean }[]>`
      SELECT (filed_report OR acted_as_official) AS disqualified
      FROM trace_record_participants WHERE record_id = ${recordId} AND actor_id = ${actorId}
    `;
    if (rows[0]?.disqualified) {
      throw new DomainError(
        403,
        'self_review_forbidden',
        'Historical record participants cannot review this record.',
      );
    }
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

  async #publicMilestones(
    tx: QuerySql,
    recordId: string,
    includeCompletion: boolean,
  ): Promise<PublicEvent[]> {
    const rows = await tx<PublicEventSourceRow[]>`
      SELECT sequence, stage, action, actor_role, created_at
      FROM trace_events
      WHERE record_id = ${recordId}
      ORDER BY sequence
    `;
    const expected = (
      row: PublicEventSourceRow | undefined,
      stage: TraceStage,
      action: string,
      actorRole: TraceRole,
    ): PublicEventSourceRow => {
      if (!row || row.stage !== stage || row.action !== action || row.actor_role !== actorRole) {
        throw integrityError();
      }
      return row;
    };
    const created = expected(
      rows.find((row) => row.action === 'record-created'),
      'voice',
      'record-created',
      'resident',
    );
    const assigned = expected(
      rows.find((row) => row.action === 'record-assigned'),
      'responsibility',
      'record-assigned',
      'official',
    );
    let approvalIndex = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]?.action === 'commitment-approved') {
        approvalIndex = index;
        break;
      }
    }
    const approval = expected(
      approvalIndex >= 0 ? rows[approvalIndex] : undefined,
      'check',
      'commitment-approved',
      'reviewer',
    );
    let filing: PublicEventSourceRow | undefined;
    for (let index = approvalIndex - 1; index >= 0; index -= 1) {
      if (rows[index]?.action === 'commitment-submitted') {
        filing = rows[index];
        break;
      }
    }
    const approvedFiling = expected(filing, 'response', 'commitment-submitted', 'official');
    const approvalTime = iso(approval.created_at);
    const milestones: PublicEvent[] = [
      {
        stage: 'voice',
        action: 'report-filed',
        actorRole: 'resident',
        createdAt: iso(created.created_at),
      },
      {
        stage: 'responsibility',
        action: 'office-assigned',
        actorRole: 'official',
        createdAt: iso(assigned.created_at),
      },
      {
        stage: 'response',
        action: 'commitment-filed',
        actorRole: 'official',
        createdAt: iso(approvedFiling.created_at),
      },
      {
        stage: 'check',
        action: 'commitment-accepted',
        actorRole: 'reviewer',
        createdAt: approvalTime,
      },
      {
        stage: 'receipt',
        action: 'published',
        actorRole: 'reviewer',
        createdAt: approvalTime,
      },
    ];
    if (includeCompletion) {
      const completion = expected(
        [...rows].reverse().find((row) => row.action === 'resolution-approved'),
        'receipt',
        'resolution-approved',
        'reviewer',
      );
      milestones.push({
        stage: 'receipt',
        action: 'completion-approved',
        actorRole: 'reviewer',
        createdAt: iso(completion.created_at),
      });
    }
    return milestones;
  }

  async #publishSnapshot(tx: QuerySql, record: RecordRow, now: string): Promise<void> {
    if (!record.public_summary || !record.commitment || !record.due_date) {
      throw new Error('approved record is missing publication fields');
    }
    const events = await this.#publicMilestones(tx, record.id, false);
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      id: record.id,
      municipalityId: record.municipality_id,
      category: record.category,
      office: record.office,
      status: 'published',
      publicSummary: record.public_summary,
      commitment: record.commitment,
      dueDate: dateOnly(record.due_date),
      evidenceNote: null,
      evidenceUrls: [],
      publishedAt: now,
      resolvedAt: null,
      events,
      testEnvironment: true,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      INSERT INTO trace_public_snapshots (
        record_id, municipality_id, category, office, public_status, public_summary, commitment,
        due_date, evidence_note, evidence_urls, published_at, resolved_at, public_events,
        receipt_hash, updated_at
      ) VALUES (
        ${record.id}, ${record.municipality_id}, ${record.category}, ${record.office}, 'published',
        ${record.public_summary}, ${record.commitment}, ${dateOnly(record.due_date)}, NULL,
        ${tx.json(jsonValue([]))}, ${now}, NULL, ${tx.json(jsonValue(events))}, ${receiptHash}, ${now}
      )
      ON CONFLICT (record_id) DO UPDATE SET
        public_status = EXCLUDED.public_status,
        public_summary = EXCLUDED.public_summary,
        commitment = EXCLUDED.commitment,
        due_date = EXCLUDED.due_date,
        evidence_note = NULL,
        evidence_urls = '[]'::jsonb,
        published_at = EXCLUDED.published_at,
        resolved_at = NULL,
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
    if (!prior || !record.evidence_note)
      throw new Error('resolution is missing an approved publication');
    const approvedPublication = verifiedPublicRecord(prior);
    const events = await this.#publicMilestones(tx, record.id, true);
    const snapshotWithoutHash: Omit<PublicRecord, 'receiptHash'> = {
      id: record.id,
      municipalityId: approvedPublication.municipalityId,
      category: approvedPublication.category,
      office: approvedPublication.office,
      status: 'resolved',
      publicSummary: approvedPublication.publicSummary,
      commitment: approvedPublication.commitment,
      dueDate: approvedPublication.dueDate,
      evidenceNote: record.evidence_note,
      evidenceUrls: [...(record.evidence_urls ?? [])],
      publishedAt: approvedPublication.publishedAt,
      resolvedAt: now,
      events,
      testEnvironment: true,
    };
    const receiptHash = computeReceiptHash(snapshotWithoutHash);
    await tx`
      UPDATE trace_public_snapshots SET
        public_status = 'resolved', evidence_note = ${record.evidence_note},
        evidence_urls = ${tx.json(jsonValue(record.evidence_urls ?? []))}, resolved_at = ${now},
        public_events = ${tx.json(jsonValue(events))}, receipt_hash = ${receiptHash}, updated_at = ${now}
      WHERE record_id = ${record.id}
    `;
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
      publicSummary: record.public_summary,
      commitment: record.commitment,
      dueDate: record.due_date ? dateOnly(record.due_date) : null,
      evidenceNote: record.evidence_note,
      evidenceUrls: [...(record.evidence_urls ?? [])],
      createdAt: iso(record.created_at),
      updatedAt: iso(record.updated_at),
      events: eventRows.map(privateEvent),
      attachments: attachmentRows.map(attachmentMetadata),
    };
  }
}

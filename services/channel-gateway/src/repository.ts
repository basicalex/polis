// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import postgres from 'postgres';

import type { ChannelStore } from './store.js';
import type {
  CallStep,
  ChannelCall,
  ChannelIdentity,
  ChannelInbox,
  ChannelLink,
  ChannelOutbox,
  ChannelRecording,
  EventState,
  InboxCompletion,
  OutboxState,
  PurgeCounts,
  RecordingUpdate,
} from './types.js';

type DateValue = Date | string;

interface IdentityRow {
  phone_hash: string;
  phone_ciphertext: Uint8Array;
  phone_nonce: Uint8Array;
  phone_tag: Uint8Array;
  key_version: number;
  municipality_id: string;
  first_seen_at: DateValue;
  last_seen_at: DateValue;
  expires_at: DateValue;
  blocked: boolean;
}

interface LinkRow {
  phone_hash: string;
  record_id: string;
  case_number: string;
  reopen_key_ciphertext: Uint8Array;
  reopen_key_nonce: Uint8Array;
  reopen_key_tag: Uint8Array;
  key_version: number;
  channel: ChannelLink['channel'];
  state: ChannelLink['state'];
  last_message_at: DateValue;
  expires_at: DateValue;
}

interface CallRow {
  call_id: string;
  phone_hash: string;
  case_number: string | null;
  record_id: string | null;
  step: ChannelCall['step'];
  created_at: DateValue;
  updated_at: DateValue;
  expires_at: DateValue;
}

interface InboxRow {
  id: string;
  provider_event_id: string | null;
  kind: ChannelInbox['kind'];
  phone_hash: string;
  body_ciphertext: Uint8Array | null;
  body_nonce: Uint8Array | null;
  body_tag: Uint8Array | null;
  key_version: number | null;
  provider_ref: string | null;
  call_control_id: string | null;
  state: ChannelInbox['state'];
  attempts: number;
  next_attempt_at: DateValue;
  last_error: string | null;
  record_id: string | null;
  case_number: string | null;
  created_at: DateValue;
  expires_at: DateValue;
}

interface OutboxRow {
  id: string;
  source_message_id: string | null;
  record_id: string;
  case_number: string;
  phone_hash: string;
  body_ciphertext: Uint8Array;
  body_nonce: Uint8Array;
  body_tag: Uint8Array;
  key_version: number;
  origin: ChannelOutbox['origin'];
  state: ChannelOutbox['state'];
  provider_message_id: string | null;
  attempts: number;
  next_attempt_at: DateValue;
  last_error: string | null;
  sent_at: DateValue | null;
  created_at: DateValue;
  expires_at: DateValue;
}

interface RecordingRow {
  id: string;
  provider_recording_id: string | null;
  inbox_id: string | null;
  state: ChannelRecording['state'];
  distorted_sha256: string | null;
  bytes: Uint8Array | null;
  created_at: DateValue;
  expires_at: DateValue;
}

function date(value: DateValue): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function nullableBytes(value: Uint8Array | null): Uint8Array | null {
  return value ? bytes(value) : null;
}

function identity(row: IdentityRow): ChannelIdentity {
  return {
    phoneHash: row.phone_hash.trim(),
    phoneCiphertext: bytes(row.phone_ciphertext),
    phoneNonce: bytes(row.phone_nonce),
    phoneTag: bytes(row.phone_tag),
    keyVersion: row.key_version,
    municipalityId: row.municipality_id,
    firstSeenAt: date(row.first_seen_at),
    lastSeenAt: date(row.last_seen_at),
    expiresAt: date(row.expires_at),
    blocked: row.blocked,
  };
}

function link(row: LinkRow): ChannelLink {
  return {
    phoneHash: row.phone_hash.trim(),
    recordId: row.record_id,
    caseNumber: row.case_number,
    reopenKeyCiphertext: bytes(row.reopen_key_ciphertext),
    reopenKeyNonce: bytes(row.reopen_key_nonce),
    reopenKeyTag: bytes(row.reopen_key_tag),
    keyVersion: row.key_version,
    channel: row.channel,
    state: row.state,
    lastMessageAt: date(row.last_message_at),
    expiresAt: date(row.expires_at),
  };
}

function call(row: CallRow): ChannelCall {
  return {
    callId: row.call_id,
    phoneHash: row.phone_hash.trim(),
    caseNumber: row.case_number,
    recordId: row.record_id,
    step: row.step,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    expiresAt: date(row.expires_at),
  };
}

function inbox(row: InboxRow): ChannelInbox {
  return {
    id: row.id,
    providerEventId: row.provider_event_id,
    kind: row.kind,
    phoneHash: row.phone_hash.trim(),
    bodyCiphertext: nullableBytes(row.body_ciphertext),
    bodyNonce: nullableBytes(row.body_nonce),
    bodyTag: nullableBytes(row.body_tag),
    keyVersion: row.key_version,
    providerRef: row.provider_ref,
    callControlId: row.call_control_id,
    state: row.state,
    attempts: row.attempts,
    nextAttemptAt: date(row.next_attempt_at),
    lastError: row.last_error,
    recordId: row.record_id,
    caseNumber: row.case_number,
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
  };
}

function outbox(row: OutboxRow): ChannelOutbox {
  return {
    id: row.id,
    sourceMessageId: row.source_message_id,
    recordId: row.record_id,
    caseNumber: row.case_number,
    phoneHash: row.phone_hash.trim(),
    bodyCiphertext: bytes(row.body_ciphertext),
    bodyNonce: bytes(row.body_nonce),
    bodyTag: bytes(row.body_tag),
    keyVersion: row.key_version,
    origin: row.origin,
    state: row.state,
    providerMessageId: row.provider_message_id,
    attempts: row.attempts,
    nextAttemptAt: date(row.next_attempt_at),
    lastError: row.last_error,
    sentAt: row.sent_at ? date(row.sent_at) : null,
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
  };
}

function recording(row: RecordingRow): ChannelRecording {
  return {
    id: row.id,
    providerRecordingId: row.provider_recording_id,
    inboxId: row.inbox_id,
    state: row.state,
    distortedSha256: row.distorted_sha256?.trim() ?? null,
    bytes: nullableBytes(row.bytes),
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
  };
}

export class PostgresChannelStore implements ChannelStore {
  readonly #sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { prepare: false, onnotice: () => undefined });
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }

  async upsertIdentity(value: ChannelIdentity): Promise<void> {
    await this.#sql`
      INSERT INTO channel_identities (
        phone_hash, phone_ciphertext, phone_nonce, phone_tag, key_version, municipality_id,
        first_seen_at, last_seen_at, expires_at, blocked
      ) VALUES (
        ${value.phoneHash}, ${value.phoneCiphertext}, ${value.phoneNonce}, ${value.phoneTag},
        ${value.keyVersion}, ${value.municipalityId}, ${value.firstSeenAt}, ${value.lastSeenAt},
        ${value.expiresAt}, ${value.blocked}
      )
      ON CONFLICT (phone_hash) DO UPDATE SET
        phone_ciphertext = EXCLUDED.phone_ciphertext,
        phone_nonce = EXCLUDED.phone_nonce,
        phone_tag = EXCLUDED.phone_tag,
        key_version = EXCLUDED.key_version,
        municipality_id = EXCLUDED.municipality_id,
        first_seen_at = LEAST(channel_identities.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(channel_identities.last_seen_at, EXCLUDED.last_seen_at),
        expires_at = GREATEST(channel_identities.expires_at, EXCLUDED.expires_at),
        blocked = channel_identities.blocked OR EXCLUDED.blocked
    `;
  }

  async getIdentity(phoneHash: string): Promise<ChannelIdentity | null> {
    const rows = await this.#sql<IdentityRow[]>`
      SELECT phone_hash, phone_ciphertext, phone_nonce, phone_tag, key_version, municipality_id,
             first_seen_at, last_seen_at, expires_at, blocked
      FROM channel_identities WHERE phone_hash = ${phoneHash} LIMIT 1
    `;
    return rows[0] ? identity(rows[0]) : null;
  }

  async setBlocked(phoneHash: string, blocked: boolean): Promise<void> {
    await this
      .#sql`UPDATE channel_identities SET blocked = ${blocked} WHERE phone_hash = ${phoneHash}`;
  }

  async listOpenLinks(phoneHash: string): Promise<ChannelLink[]> {
    const rows = await this.#sql<LinkRow[]>`
      SELECT phone_hash, record_id, case_number, reopen_key_ciphertext, reopen_key_nonce,
             reopen_key_tag, key_version, channel, state, last_message_at, expires_at
      FROM channel_links
      WHERE phone_hash = ${phoneHash} AND state = 'open'
      ORDER BY last_message_at DESC
    `;
    return rows.map(link);
  }

  async findLinkByRecord(recordId: string): Promise<ChannelLink | null> {
    const rows = await this.#sql<LinkRow[]>`
      SELECT phone_hash, record_id, case_number, reopen_key_ciphertext, reopen_key_nonce,
             reopen_key_tag, key_version, channel, state, last_message_at, expires_at
      FROM channel_links
      WHERE record_id = ${recordId}
      LIMIT 1
    `;
    return rows[0] ? link(rows[0]) : null;
  }

  async upsertLink(value: ChannelLink): Promise<void> {
    await this.#sql`
      INSERT INTO channel_links (
        phone_hash, record_id, case_number, reopen_key_ciphertext, reopen_key_nonce,
        reopen_key_tag, key_version, channel, state, last_message_at, expires_at
      ) VALUES (
        ${value.phoneHash}, ${value.recordId}, ${value.caseNumber}, ${value.reopenKeyCiphertext},
        ${value.reopenKeyNonce}, ${value.reopenKeyTag}, ${value.keyVersion}, ${value.channel},
        ${value.state}, ${value.lastMessageAt}, ${value.expiresAt}
      )
      ON CONFLICT (phone_hash, record_id) DO UPDATE SET
        case_number = EXCLUDED.case_number,
        reopen_key_ciphertext = EXCLUDED.reopen_key_ciphertext,
        reopen_key_nonce = EXCLUDED.reopen_key_nonce,
        reopen_key_tag = EXCLUDED.reopen_key_tag,
        key_version = EXCLUDED.key_version,
        channel = EXCLUDED.channel,
        state = EXCLUDED.state,
        last_message_at = EXCLUDED.last_message_at,
        expires_at = EXCLUDED.expires_at
    `;
  }

  async closeLink(phoneHash: string, recordId: string): Promise<void> {
    await this.#sql`
      UPDATE channel_links SET state = 'closed'
      WHERE phone_hash = ${phoneHash} AND record_id = ${recordId}
    `;
  }
  async upsertCall(value: ChannelCall): Promise<void> {
    await this.#sql`
      INSERT INTO channel_calls (
        call_id, phone_hash, case_number, record_id, step, created_at, updated_at, expires_at
      ) VALUES (
        ${value.callId}, ${value.phoneHash}, ${value.caseNumber}, ${value.recordId}, ${value.step},
        ${value.createdAt}, ${value.updatedAt}, ${value.expiresAt}
      )
      ON CONFLICT (call_id) DO UPDATE SET
        phone_hash = EXCLUDED.phone_hash,
        case_number = EXCLUDED.case_number,
        record_id = EXCLUDED.record_id,
        step = EXCLUDED.step,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at
    `;
  }

  async getCall(callId: string): Promise<ChannelCall | null> {
    const rows = await this.#sql<CallRow[]>`
      SELECT call_id, phone_hash, case_number, record_id, step, created_at, updated_at, expires_at
      FROM channel_calls
      WHERE call_id = ${callId}
      LIMIT 1
    `;
    return rows[0] ? call(rows[0]) : null;
  }

  async markCallStep(callId: string, step: CallStep, updatedAt: Date): Promise<void> {
    await this.#sql`
      UPDATE channel_calls SET step = ${step}, updated_at = ${updatedAt}
      WHERE call_id = ${callId}
    `;
  }

  async recordEvent(
    provider: string,
    eventId: string,
    eventType: string,
    payloadSha256: string,
  ): Promise<{ duplicate: boolean }> {
    const rows = await this.#sql<{ event_id: string }[]>`
      INSERT INTO channel_events (
        provider, event_id, event_type, payload_sha256, state, attempts, received_at, expires_at
      ) VALUES (
        ${provider}, ${eventId}, ${eventType}, ${payloadSha256}, 'received', 0, NOW(),
        NOW() + INTERVAL '168 hours'
      )
      ON CONFLICT (provider, event_id) DO NOTHING
      RETURNING event_id
    `;
    return { duplicate: rows.length === 0 };
  }

  async markEvent(
    provider: string,
    eventId: string,
    state: EventState,
    lastError: string | null = null,
  ): Promise<void> {
    await this.#sql`
      UPDATE channel_events
      SET state = ${state}, attempts = attempts + 1, last_error = ${lastError}
      WHERE provider = ${provider} AND event_id = ${eventId}
    `;
  }

  async enqueueInbox(value: ChannelInbox): Promise<void> {
    await this.#sql`
      INSERT INTO channel_inbox (
        id, provider_event_id, kind, phone_hash, body_ciphertext, body_nonce, body_tag,
        key_version, provider_ref, call_control_id, state, attempts, next_attempt_at,
        last_error, record_id, case_number, created_at, expires_at
      ) VALUES (
        ${value.id}, ${value.providerEventId}, ${value.kind}, ${value.phoneHash},
        ${value.bodyCiphertext}, ${value.bodyNonce}, ${value.bodyTag}, ${value.keyVersion},
        ${value.providerRef}, ${value.callControlId}, ${value.state}, ${value.attempts},
        ${value.nextAttemptAt}, ${value.lastError}, ${value.recordId}, ${value.caseNumber},
        ${value.createdAt}, ${value.expiresAt}
      )
      ON CONFLICT (provider_event_id) DO NOTHING
    `;
  }

  async claimInbox(now: Date, limit: number): Promise<ChannelInbox[]> {
    const rows = await this.#sql<InboxRow[]>`
      WITH picked AS (
        SELECT id FROM channel_inbox
        WHERE state IN ('pending', 'failed') AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE channel_inbox AS item
      SET state = 'processing', attempts = item.attempts + 1, last_error = NULL
      FROM picked
      WHERE item.id = picked.id
      RETURNING item.*
    `;
    return rows.map(inbox);
  }

  async completeInbox(id: string, completion: InboxCompletion = {}): Promise<void> {
    const current = await this.#sql<{ record_id: string | null; case_number: string | null }[]>`
      SELECT record_id, case_number FROM channel_inbox WHERE id = ${id} LIMIT 1
    `;
    const row = current[0];
    if (!row) return;
    await this.#sql`
      UPDATE channel_inbox
      SET state = 'done', last_error = NULL,
          body_ciphertext = NULL, body_nonce = NULL, body_tag = NULL, key_version = NULL,
          record_id = ${completion.recordId === undefined ? row.record_id : completion.recordId},
          case_number = ${completion.caseNumber === undefined ? row.case_number : completion.caseNumber}
      WHERE id = ${id}
    `;
  }

  async failInbox(id: string, lastError: string, nextAttemptAt: Date): Promise<void> {
    await this.#sql`
      UPDATE channel_inbox
      SET state = 'failed', last_error = ${lastError}, next_attempt_at = ${nextAttemptAt}
      WHERE id = ${id}
    `;
  }

  async enqueueOutbox(value: ChannelOutbox): Promise<void> {
    await this.#sql`
      INSERT INTO channel_outbox (
        id, source_message_id, record_id, case_number, phone_hash, body_ciphertext,
        body_nonce, body_tag, key_version, origin, state, provider_message_id, attempts,
        next_attempt_at, last_error, sent_at, created_at, expires_at
      ) VALUES (
        ${value.id}, ${value.sourceMessageId}, ${value.recordId}, ${value.caseNumber},
        ${value.phoneHash}, ${value.bodyCiphertext}, ${value.bodyNonce}, ${value.bodyTag},
        ${value.keyVersion}, ${value.origin}, ${value.state}, ${value.providerMessageId},
        ${value.attempts}, ${value.nextAttemptAt}, ${value.lastError}, ${value.sentAt},
        ${value.createdAt}, ${value.expiresAt}
      )
      ON CONFLICT (source_message_id) DO NOTHING
    `;
  }

  async claimOutbox(now: Date, limit: number): Promise<ChannelOutbox[]> {
    const leaseUntil = new Date(now.getTime() + 60_000);
    const rows = await this.#sql<OutboxRow[]>`
      WITH picked AS (
        SELECT id FROM channel_outbox
        WHERE state = 'pending' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE channel_outbox AS item
      SET attempts = item.attempts + 1, next_attempt_at = ${leaseUntil}, last_error = NULL
      FROM picked
      WHERE item.id = picked.id
      RETURNING item.*
    `;
    return rows.map(outbox);
  }

  async markOutboxSent(id: string, providerMessageId: string, sentAt: Date): Promise<void> {
    await this.#sql`
      UPDATE channel_outbox
      SET state = 'sent', provider_message_id = ${providerMessageId}, sent_at = ${sentAt},
          last_error = NULL
      WHERE id = ${id}
    `;
  }

  async markOutboxFailed(id: string, lastError: string): Promise<void> {
    await this.#sql`
      UPDATE channel_outbox SET state = 'failed', last_error = ${lastError}
      WHERE id = ${id}
    `;
  }

  async markOutboxDelivery(
    providerMessageId: string,
    state: Extract<OutboxState, 'delivered' | 'failed'>,
    failureCode?: string,
  ): Promise<void> {
    await this.#sql`
      UPDATE channel_outbox SET state = ${state}, last_error = ${failureCode ?? null}
      WHERE provider_message_id = ${providerMessageId}
    `;
  }

  async findOutboxBySource(sourceMessageId: string): Promise<ChannelOutbox | null> {
    const rows = await this.#sql<OutboxRow[]>`
      SELECT * FROM channel_outbox WHERE source_message_id = ${sourceMessageId} LIMIT 1
    `;
    return rows[0] ? outbox(rows[0]) : null;
  }

  async putRecording(value: ChannelRecording): Promise<void> {
    await this.#sql`
      INSERT INTO channel_recordings (
        id, provider_recording_id, inbox_id, state, distorted_sha256, bytes, created_at, expires_at
      ) VALUES (
        ${value.id}, ${value.providerRecordingId}, ${value.inboxId}, ${value.state},
        ${value.distortedSha256}, ${value.bytes}, ${value.createdAt}, ${value.expiresAt}
      )
      ON CONFLICT (provider_recording_id) DO UPDATE SET
        inbox_id = EXCLUDED.inbox_id,
        state = EXCLUDED.state,
        distorted_sha256 = EXCLUDED.distorted_sha256,
        bytes = EXCLUDED.bytes,
        expires_at = EXCLUDED.expires_at
    `;
  }

  async getRecording(id: string): Promise<ChannelRecording | null> {
    const rows = await this.#sql<RecordingRow[]>`
      SELECT * FROM channel_recordings WHERE id = ${id} LIMIT 1
    `;
    return rows[0] ? recording(rows[0]) : null;
  }

  async updateRecording(id: string, update: RecordingUpdate): Promise<void> {
    const current = await this.getRecording(id);
    if (!current) return;
    await this.#sql`
      UPDATE channel_recordings
      SET state = ${update.state ?? current.state},
          distorted_sha256 = ${update.distortedSha256 === undefined ? current.distortedSha256 : update.distortedSha256},
          bytes = ${update.bytes === undefined ? current.bytes : update.bytes},
          expires_at = ${update.expiresAt ?? current.expiresAt}
      WHERE id = ${id}
    `;
  }

  async bumpRate(scope: string, key: string, windowStart: Date): Promise<number> {
    const rows = await this.#sql<{ count: number }[]>`
      INSERT INTO channel_rate_windows (scope, key, window_start, count)
      VALUES (${scope}, ${key}, ${windowStart}, 1)
      ON CONFLICT (scope, key, window_start) DO UPDATE
      SET count = channel_rate_windows.count + 1
      RETURNING count
    `;
    return rows[0]!.count;
  }

  async purgeExpired(now: Date): Promise<PurgeCounts> {
    return this.#sql.begin(async (tx) => {
      const events = await tx`DELETE FROM channel_events WHERE expires_at <= ${now}`;
      const inboxRows = await tx`DELETE FROM channel_inbox WHERE expires_at <= ${now}`;
      const outboxRows = await tx`DELETE FROM channel_outbox WHERE expires_at <= ${now}`;
      const recordings = await tx`DELETE FROM channel_recordings WHERE expires_at <= ${now}`;
      const calls = await tx`DELETE FROM channel_calls WHERE expires_at <= ${now}`;
      const links = await tx`DELETE FROM channel_links WHERE expires_at <= ${now}`;
      const identities = await tx`
        DELETE FROM channel_identities AS identity
        WHERE identity.expires_at <= ${now}
          AND NOT EXISTS (
            SELECT 1 FROM channel_links AS link WHERE link.phone_hash = identity.phone_hash
          )
      `;
      return {
        events: events.count,
        inbox: inboxRows.count,
        outbox: outboxRows.count,
        recordings: recordings.count,
        calls: calls.count,
        links: links.count,
        identities: identities.count,
      };
    });
  }

  async ping(): Promise<void> {
    await this.#sql`SELECT 1`;
  }
}

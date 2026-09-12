// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomUUID } from 'node:crypto';

import { openString, phoneHash, sealString, verifyTelnyxSignature } from './crypto.js';
import { phoneHashPrefix } from './log.js';
import { normalizeE164 } from './phone.js';
import type { ChannelLink, ChannelOutbox } from './types.js';
import { SMS_APPENDED, SMS_BLOCKED, SMS_CONFIRM } from './copy-hr.js';
import { handleRecordingSaved } from './voice.js';

export type { TelnyxEvent, PipelineDeps, InboxRow } from './pipeline-types.js';
import type { PipelineDeps, TelnyxEvent, InboxRow } from './pipeline-types.js';

type HeaderBag = Record<string, string | string[] | undefined> | Headers;

export interface MessagingResult {
  status: number;
  body: { accepted?: true; duplicate?: boolean; error?: string; code?: string };
}

export interface MessagingOptions {
  stubInjection?: boolean;
  scheduleProcessing?: boolean;
}

const SMS_COMMAND_STOP = /^(stop|stoj|prekid)$/iu;
const SMS_COMMAND_START = /^(start|počni|pocni)$/iu;

function header(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}
function emitAudit(deps: PipelineDeps, event: Parameters<PipelineDeps['audit']['emit']>[0]): void {
  void deps.audit.emit(event).catch(() => undefined);
}

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function keyFor(deps: PipelineDeps, version: number): Uint8Array {
  const key = deps.config.vaultKeys.get(version);
  if (!key) throw new Error(`missing vault key v${version}`);
  return key;
}

function activeKey(deps: PipelineDeps): { version: number; key: Uint8Array } {
  const version = deps.config.activeVaultKeyVersion;
  return { version, key: keyFor(deps, version) };
}

function ttl(deps: PipelineDeps, days: number): Date {
  return new Date(deps.now().getTime() + days * 86_400_000);
}

function plus(ms: number, deps: PipelineDeps): Date {
  return new Date(deps.now().getTime() + ms);
}

function parseEvent(rawBody: Uint8Array): TelnyxEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const id = record.id;
  const eventType = record.event_type;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof eventType !== 'string' || eventType.length === 0) return null;
  const payload = record.payload;
  return {
    id,
    eventType,
    occurredAt: typeof record.occurred_at === 'string' ? record.occurred_at : null,
    payload: payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {},
    payloadSha256: sha256Hex(rawBody),
  };
}

function payloadText(payload: Record<string, unknown>): string {
  const text = payload.text;
  return typeof text === 'string' ? text : '';
}

function payloadFrom(payload: Record<string, unknown>): string | null {
  const from = payload.from;
  if (!from || typeof from !== 'object') return null;
  const phone = (from as Record<string, unknown>).phone_number;
  return typeof phone === 'string' ? phone : null;
}
function payloadMessageId(payload: Record<string, unknown>): string | null {
  const value = payload.id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function deliveryState(event: TelnyxEvent): 'delivered' | 'failed' {
  if (event.eventType === 'message.sent') return 'delivered';
  const recipients = event.payload.to;
  if (!Array.isArray(recipients)) return 'delivered';
  const failed = recipients.some((recipient) => {
    if (!recipient || typeof recipient !== 'object') return false;
    const status = (recipient as Record<string, unknown>).status;
    return typeof status === 'string' && /fail|reject|expire/i.test(status);
  });
  return failed ? 'failed' : 'delivered';
}

function sealBody(
  deps: PipelineDeps,
  text: string,
  aad: 'sms-body' | 'outbox-body' | 'phone' | 'reopen-key',
) {
  const { version, key } = activeKey(deps);
  return { version, sealed: sealString(key, text, aad) };
}

function openBody(deps: PipelineDeps, row: InboxRow): string {
  if (!row.bodyCiphertext || !row.bodyNonce || !row.bodyTag || row.keyVersion == null) return '';
  return openString(
    keyFor(deps, row.keyVersion),
    {
      ciphertext: Buffer.from(row.bodyCiphertext),
      nonce: Buffer.from(row.bodyNonce),
      tag: Buffer.from(row.bodyTag),
    },
    'sms-body',
  );
}

function openReopenKey(deps: PipelineDeps, link: ChannelLink): string {
  return openString(
    keyFor(deps, link.keyVersion),
    {
      ciphertext: Buffer.from(link.reopenKeyCiphertext),
      nonce: Buffer.from(link.reopenKeyNonce),
      tag: Buffer.from(link.reopenKeyTag),
    },
    'reopen-key',
  );
}

async function enqueueConfirmation(
  deps: PipelineDeps,
  input: {
    phoneHash: string;
    recordId: string;
    caseNumber: string;
    text: string;
    sourceMessageId: string | null;
    origin?: ChannelOutbox['origin'];
  },
): Promise<void> {
  const { version, sealed } = sealBody(deps, input.text, 'outbox-body');
  const now = deps.now();
  const row: ChannelOutbox = {
    id: randomUUID(),
    sourceMessageId: input.sourceMessageId,
    recordId: input.recordId,
    caseNumber: input.caseNumber,
    phoneHash: input.phoneHash,
    bodyCiphertext: sealed.ciphertext,
    bodyNonce: sealed.nonce,
    bodyTag: sealed.tag,
    keyVersion: version,
    origin: input.origin ?? 'confirmation',
    state: 'pending',
    providerMessageId: null,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    sentAt: null,
    createdAt: now,
    expiresAt: ttl(deps, deps.config.vaultTtlDays),
  };
  await deps.store.enqueueOutbox(row);
}

async function upsertIdentity(deps: PipelineDeps, e164: string, hash: string): Promise<void> {
  const existing = await deps.store.getIdentity(hash);
  const { version, sealed } = sealBody(deps, e164, 'phone');
  const now = deps.now();
  await deps.store.upsertIdentity({
    phoneHash: hash,
    phoneCiphertext: sealed.ciphertext,
    phoneNonce: sealed.nonce,
    phoneTag: sealed.tag,
    keyVersion: version,
    municipalityId: deps.config.municipalityId,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    expiresAt: ttl(deps, deps.config.vaultTtlDays),
    blocked: existing?.blocked ?? false,
  });
}

export async function handleMessagingEvent(
  rawBody: Uint8Array,
  headers: HeaderBag,
  deps: PipelineDeps,
  options: MessagingOptions = {},
): Promise<MessagingResult> {
  if (!options.stubInjection) {
    const telnyx = deps.config.telnyx;
    if (
      !telnyx ||
      !verifyTelnyxSignature({
        publicKey: telnyx.publicKey,
        signature: header(headers, 'telnyx-signature-ed25519'),
        timestamp: header(headers, 'telnyx-timestamp'),
        rawBody,
        toleranceSeconds: telnyx.signatureToleranceSeconds,
        now: Math.floor(deps.now().getTime() / 1000),
      })
    ) {
      return { status: 401, body: { error: 'invalid_signature' } };
    }
  } else if (deps.config.channelProvider !== 'stub') {
    return { status: 401, body: { error: 'invalid_signature' } };
  }

  const event = parseEvent(rawBody);
  if (!event) return { status: 400, body: { error: 'invalid_event' } };
  const recorded = await deps.store.recordEvent(
    deps.provider.name,
    event.id,
    event.eventType,
    event.payloadSha256,
  );
  if (recorded.duplicate) return { status: 202, body: { accepted: true, duplicate: true } };

  try {
    if (event.eventType === 'message.sent' || event.eventType === 'message.finalized') {
      const providerMessageId = payloadMessageId(event.payload);
      if (providerMessageId) {
        await deps.store.markOutboxDelivery(providerMessageId, deliveryState(event));
      }
      await deps.store.markEvent(deps.provider.name, event.id, 'processed');
      return { status: 202, body: { accepted: true, duplicate: false } };
    }
    if (event.eventType !== 'message.received') {
      await deps.store.markEvent(deps.provider.name, event.id, 'processed');
      return { status: 202, body: { accepted: true, duplicate: false } };
    }
    const from = payloadFrom(event.payload);
    let e164: string;
    try {
      e164 = from ? normalizeE164(from) : '';
      if (!e164) throw new Error('missing sender');
    } catch {
      emitAudit(deps, {
        eventType: 'channel.identity.blocked',
        code: 'sender_rejected',
        channel: 'sms',
        eventId: event.id,
      });
      await deps.store.markEvent(deps.provider.name, event.id, 'processed');
      return { status: 202, body: { accepted: true, code: 'sender_rejected' } };
    }
    const hash = phoneHash(e164, deps.config.vaultPepper, deps.config.municipalityId);
    await upsertIdentity(deps, e164, hash);
    const text = payloadText(event.payload).slice(0, deps.config.maxInboundChars);
    const normalized = text.trim();
    if (SMS_COMMAND_STOP.test(normalized)) {
      await deps.store.setBlocked(hash, true);
      await enqueueConfirmation(deps, {
        phoneHash: hash,
        recordId: randomUUID(),
        caseNumber: 'system',
        text: SMS_BLOCKED,
        sourceMessageId: `stop:${event.id}`,
        origin: 'system',
      });
      emitAudit(deps, {
        eventType: 'channel.identity.blocked',
        code: 'blocked',
        channel: 'sms',
        eventId: event.id,
        phoneHashPrefix: phoneHashPrefix(hash),
      });
      await deps.store.markEvent(deps.provider.name, event.id, 'processed');
      return { status: 202, body: { accepted: true, duplicate: false } };
    }
    if (SMS_COMMAND_START.test(normalized)) {
      await deps.store.setBlocked(hash, false);
      await deps.store.markEvent(deps.provider.name, event.id, 'processed');
      return { status: 202, body: { accepted: true, duplicate: false } };
    }
    if ((await deps.store.getIdentity(hash))?.blocked) {
      await deps.store.markEvent(deps.provider.name, event.id, 'processed');
      return { status: 202, body: { accepted: true, duplicate: false } };
    }

    const { version, sealed } = sealBody(deps, text, 'sms-body');
    const now = deps.now();
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : now;
    const createdAt = Number.isNaN(occurredAt.getTime()) ? now : occurredAt;
    await deps.store.enqueueInbox({
      id: randomUUID(),
      providerEventId: event.id,
      kind: 'sms_inbound',
      phoneHash: hash,
      bodyCiphertext: sealed.ciphertext,
      bodyNonce: sealed.nonce,
      bodyTag: sealed.tag,
      keyVersion: version,
      providerRef: null,
      callControlId: null,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      recordId: null,
      caseNumber: null,
      createdAt,
      expiresAt: ttl(deps, deps.config.vaultTtlDays),
    });
    emitAudit(deps, {
      eventType: 'channel.sms.received',
      code: 'received',
      channel: 'sms',
      eventId: event.id,
      phoneHashPrefix: phoneHashPrefix(hash),
    });
    await deps.store.markEvent(deps.provider.name, event.id, 'processed');
    if (options.scheduleProcessing !== false) {
      queueMicrotask(() => {
        void runInboxCycle(deps).catch((error: unknown) => {
          deps.log({
            service: 'channel-gateway',
            stage: 'inbox',
            code: 'cycle_failed',
            error: error instanceof Error ? error.message : 'inbox_cycle_failed',
          });
        });
      });
    }
    return { status: 202, body: { accepted: true, duplicate: false } };
  } catch (error) {
    await deps.store.markEvent(
      deps.provider.name,
      event.id,
      'failed',
      error instanceof Error ? error.message : 'failed',
    );
    throw error;
  }
}

function selectedLink(links: ChannelLink[], text: string): ChannelLink | null {
  if (links.length === 0) return null;
  const targeted = /^\s*([A-Z]{2,10}-\d{1,12})(?:\s*[:,;-]\s*|\s+)/iu.exec(text)?.[1];
  if (!targeted) return links[0] ?? null;
  return (
    links.find((link) => link.caseNumber.toUpperCase() === targeted.toUpperCase()) ??
    links[0] ??
    null
  );
}

async function createOrAppend(
  row: InboxRow,
  deps: PipelineDeps,
): Promise<{ recordId: string; caseNumber: string; created: boolean } | null> {
  const text = openBody(deps, row);
  const links = await deps.store.listOpenLinks(row.phoneHash);
  const link = selectedLink(links, text);
  if (link) {
    const reopenKey = openReopenKey(deps, link);
    await deps.trace.appendChannelMessage(
      link.caseNumber,
      {
        reopenKey,
        channel: 'sms',
        kind: 'append',
        text,
        source: 'typed',
        occurredAt: row.createdAt.toISOString(),
      },
      `append:${row.id}`,
    );
    await deps.store.upsertLink({
      ...link,
      lastMessageAt: deps.now(),
      expiresAt: ttl(deps, deps.config.vaultTtlDays),
    });
    await deps.audit.emit({
      eventType: 'channel.message.appended',
      code: 'appended',
      channel: 'sms',
      phoneHashPrefix: phoneHashPrefix(row.phoneHash),
      recordId: link.recordId,
      caseNumber: link.caseNumber,
    });
    if (deps.config.ackAppends)
      await enqueueConfirmation(deps, {
        phoneHash: row.phoneHash,
        recordId: link.recordId,
        caseNumber: link.caseNumber,
        text: SMS_APPENDED(link.caseNumber),
        sourceMessageId: `ack:${row.id}`,
      });
    return { recordId: link.recordId, caseNumber: link.caseNumber, created: false };
  }

  const day = new Date(
    Date.UTC(deps.now().getUTCFullYear(), deps.now().getUTCMonth(), deps.now().getUTCDate()),
  );
  const newCases = await deps.store.bumpRate('new-cases-per-hash-day', row.phoneHash, day);
  if (newCases > deps.config.newCasesPerHashPerDay) return null;
  const created = await deps.trace.createChannelCase(
    { channel: 'sms', text, source: 'typed', occurredAt: row.createdAt.toISOString() },
    `case:${row.id}`,
  );
  const reopen = sealBody(deps, created.case.reopenKey, 'reopen-key');
  await deps.store.upsertLink({
    phoneHash: row.phoneHash,
    recordId: created.case.recordId,
    caseNumber: created.case.caseNumber,
    reopenKeyCiphertext: reopen.sealed.ciphertext,
    reopenKeyNonce: reopen.sealed.nonce,
    reopenKeyTag: reopen.sealed.tag,
    keyVersion: reopen.version,
    channel: 'sms',
    state: 'open',
    lastMessageAt: deps.now(),
    expiresAt: ttl(deps, deps.config.vaultTtlDays),
  });
  await deps.audit.emit({
    eventType: 'channel.case.created',
    code: 'created',
    channel: 'sms',
    phoneHashPrefix: phoneHashPrefix(row.phoneHash),
    recordId: created.case.recordId,
    caseNumber: created.case.caseNumber,
  });
  await enqueueConfirmation(deps, {
    phoneHash: row.phoneHash,
    recordId: created.case.recordId,
    caseNumber: created.case.caseNumber,
    text: SMS_CONFIRM(created.case.caseNumber),
    sourceMessageId: `ack:${row.id}`,
  });
  return { recordId: created.case.recordId, caseNumber: created.case.caseNumber, created: true };
}

export async function runInboxCycle(
  deps: PipelineDeps,
  limit = 25,
): Promise<{ processed: number; failed: number }> {
  const rows = await deps.store.claimInbox(deps.now(), limit);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (row.kind === 'voice_recording') {
        // The voice handler owns completion/failure because it records transcript state atomically.
        await handleRecordingSaved(row, deps);
      } else if (row.kind === 'sms_inbound') {
        const now = deps.now();
        const hour = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
        );
        const inbound = await deps.store.bumpRate('inbound-hash-hour', row.phoneHash, hour);
        if (inbound > deps.config.inboundPerHashPerHour) {
          await deps.store.completeInbox(row.id);
          deps.log({
            service: 'channel-gateway',
            stage: 'inbox',
            code: 'rate_limited',
            phoneHashPrefix: phoneHashPrefix(row.phoneHash),
          });
        } else {
          const outcome = await createOrAppend(row, deps);
          if (outcome) {
            await deps.store.completeInbox(row.id, outcome);
          } else {
            await deps.store.completeInbox(row.id);
            deps.log({
              service: 'channel-gateway',
              stage: 'inbox',
              code: 'new_case_rate_limited',
              phoneHashPrefix: phoneHashPrefix(row.phoneHash),
            });
          }
        }
      } else {
        await deps.store.completeInbox(row.id, {
          recordId: row.recordId,
          caseNumber: row.caseNumber,
        });
      }
      processed += 1;
    } catch (error) {
      failed += 1;
      const attempts = row.attempts;
      const message = error instanceof Error ? error.message : 'inbox_failed';
      const nextAttemptAt =
        attempts >= deps.config.outboundMaxAttempts
          ? new Date(8_640_000_000_000_000)
          : plus(2 ** attempts * 60_000, deps);
      await deps.store.failInbox(row.id, message, nextAttemptAt);
      deps.log({
        service: 'channel-gateway',
        stage: 'inbox',
        code: 'failed',
        attempts,
        error: message,
        phoneHashPrefix: phoneHashPrefix(row.phoneHash),
      });
    }
  }
  return { processed, failed };
}

export const __private = { parseEvent, sha256Hex, openBody };

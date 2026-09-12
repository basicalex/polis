// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { openString, sealString } from './crypto.js';
import { phoneHashPrefix } from './log.js';
import { SMS_RELAY } from './copy-hr.js';
import type { PipelineDeps } from './pipeline-types.js';
import type { ChannelOutbox } from './types.js';

function keyFor(deps: PipelineDeps, version: number): Uint8Array {
  const key = deps.config.vaultKeys.get(version);
  if (!key) throw new Error(`missing vault key v${version}`);
  return key;
}

function ttl(deps: PipelineDeps): Date {
  return new Date(deps.now().getTime() + deps.config.vaultTtlDays * 86_400_000);
}

function windowHour(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
  );
}

function windowDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function windowMinute(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
    ),
  );
}

function sealOutbox(deps: PipelineDeps, text: string) {
  const version = deps.config.activeVaultKeyVersion;
  return { version, sealed: sealString(keyFor(deps, version), text, 'outbox-body') };
}

function decryptPhone(
  deps: PipelineDeps,
  row: {
    phoneCiphertext: Uint8Array;
    phoneNonce: Uint8Array;
    phoneTag: Uint8Array;
    keyVersion: number;
  },
): string {
  return openString(
    keyFor(deps, row.keyVersion),
    {
      ciphertext: Buffer.from(row.phoneCiphertext),
      nonce: Buffer.from(row.phoneNonce),
      tag: Buffer.from(row.phoneTag),
    },
    'phone',
  );
}

function decryptBody(deps: PipelineDeps, row: ChannelOutbox): string {
  return openString(
    keyFor(deps, row.keyVersion),
    {
      ciphertext: Buffer.from(row.bodyCiphertext),
      nonce: Buffer.from(row.bodyNonce),
      tag: Buffer.from(row.bodyTag),
    },
    'outbox-body',
  );
}

async function failTrace(deps: PipelineDeps, messageId: string, code: string): Promise<void> {
  await deps.trace.markDelivery(
    messageId,
    { state: 'failed', failureCode: code },
    `relay-failed:${messageId}:${code}`,
  );
}

async function markLocalFailed(
  deps: PipelineDeps,
  row: ChannelOutbox,
  code: string,
): Promise<void> {
  await deps.store.markOutboxFailed(row.id, code);
}

export async function runRelayCycle(
  deps: PipelineDeps,
): Promise<{ handedOff: number; failed: number; duplicates: number }> {
  const outbox = await deps.trace.listOutbox(50);
  let handedOff = 0;
  let failed = 0;
  let duplicates = 0;
  for (const message of outbox.messages) {
    const existing = await deps.store.findOutboxBySource(message.id);
    if (existing) {
      duplicates += 1;
      continue;
    }
    const link = await deps.store.findLinkByRecord(message.recordId);
    if (!link) {
      await failTrace(deps, message.id, 'no_channel');
      failed += 1;
      continue;
    }
    const identity = await deps.store.getIdentity(link.phoneHash);
    if (!identity || identity.blocked) {
      await failTrace(deps, message.id, 'blocked');
      failed += 1;
      continue;
    }
    const { version, sealed } = sealOutbox(deps, message.body);
    const now = deps.now();
    await deps.store.enqueueOutbox({
      id: randomUUID(),
      sourceMessageId: message.id,
      recordId: link.recordId,
      caseNumber: link.caseNumber,
      phoneHash: link.phoneHash,
      bodyCiphertext: sealed.ciphertext,
      bodyNonce: sealed.nonce,
      bodyTag: sealed.tag,
      keyVersion: version,
      origin: 'relay',
      state: 'pending',
      providerMessageId: null,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      sentAt: null,
      createdAt: now,
      expiresAt: ttl(deps),
    });
    await deps.trace.markDelivery(
      message.id,
      { state: 'handed-off' },
      `relay-handed-off:${message.id}`,
    );
    handedOff += 1;
  }
  return { handedOff, failed, duplicates };
}

async function withinCaps(deps: PipelineDeps, row: ChannelOutbox): Promise<boolean> {
  const now = deps.now();
  const caseCount = await deps.store.bumpRate('outbound-case-hour', row.recordId, windowHour(now));
  if (caseCount > deps.config.outboundPerCasePerHour) return false;
  const hashCount = await deps.store.bumpRate('outbound-hash-day', row.phoneHash, windowDay(now));
  if (hashCount > deps.config.outboundPerHashPerDay) return false;
  const globalCount = await deps.store.bumpRate('outbound-minute', 'global', windowMinute(now));
  return globalCount <= deps.config.outboundPerMinute;
}

export async function deliverOutbound(
  deps: PipelineDeps,
  limit = 25,
): Promise<{ sent: number; deferred: number; failed: number }> {
  const rows = await deps.store.claimOutbox(deps.now(), limit);
  let sent = 0;
  let deferred = 0;
  let failed = 0;
  for (const row of rows) {
    const identity = await deps.store.getIdentity(row.phoneHash);
    if (!identity || (identity.blocked && row.origin !== 'system')) {
      const code = identity ? 'blocked' : 'identity_missing';
      if (row.sourceMessageId) await failTrace(deps, row.sourceMessageId, code);
      await markLocalFailed(deps, row, code);
      failed += 1;
      continue;
    }
    if (!(await withinCaps(deps, row))) {
      // claimOutbox already moves nextAttemptAt forward without dropping the row.
      deferred += 1;
      continue;
    }
    try {
      const to = decryptPhone(deps, identity);
      const body = decryptBody(deps, row);
      const text = row.origin === 'relay' ? SMS_RELAY(row.caseNumber, body) : body;
      const delivered = await deps.provider.sendSms({ to, text, idempotencyKey: row.id });
      await deps.store.markOutboxSent(row.id, delivered.providerMessageId, deps.now());
      await deps.audit.emit({
        eventType: 'channel.sms.sent',
        code: 'sent',
        channel: 'sms',
        phoneHashPrefix: phoneHashPrefix(row.phoneHash),
        recordId: row.recordId,
        caseNumber: row.caseNumber,
      });
      sent += 1;
    } catch (error) {
      const attempts = row.attempts;
      const message = error instanceof Error ? error.message : 'send_failed';
      if (attempts >= deps.config.outboundMaxAttempts) {
        await markLocalFailed(deps, row, 'provider_failed');
        if (row.sourceMessageId) await failTrace(deps, row.sourceMessageId, 'provider_failed');
        await deps.audit.emit({
          eventType: 'channel.sms.failed',
          code: 'provider_failed',
          channel: 'sms',
          phoneHashPrefix: phoneHashPrefix(row.phoneHash),
          recordId: row.recordId,
          caseNumber: row.caseNumber,
        });
        failed += 1;
      } else {
        // claimOutbox's lease is the retry backoff available through the frozen store contract.
        deferred += 1;
      }
      deps.log({
        service: 'channel-gateway',
        stage: 'outbox',
        code: 'failed',
        attempts,
        error: message,
        phoneHashPrefix: phoneHashPrefix(row.phoneHash),
        recordId: row.recordId,
        caseNumber: row.caseNumber,
      });
    }
  }
  return { sent, deferred, failed };
}

export const __private = { decryptPhone, decryptBody };

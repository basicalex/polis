// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChannelConfig } from './config.js';
import { openString, phoneHash, sealString } from './crypto.js';
import { MemoryChannelStore } from './memory-store.js';
import type { PipelineDeps, TraceClient } from './pipeline-types.js';
import { deliverOutbound, runRelayCycle } from './relay.js';
import type { ChannelIdentity, ChannelLink, ChannelOutbox } from './types.js';

const key = Buffer.alloc(32, 8);
const initialNow = new Date('2026-09-12T12:00:00.000Z');
const phone = ['+385', '91', '111', '1111'].join('');

function config(overrides: Partial<ChannelConfig> = {}): ChannelConfig {
  return {
    internalApiToken: 'token',
    databaseUrl: 'memory',
    traceInternalUrl: 'http://trace.internal',
    traceGatewayActorId: 'channel-gateway',
    municipalityId: 'vrsar-orsera',
    deploymentProfile: 'dev',
    channelProvider: 'stub',
    sttProvider: 'stub',
    processingAgreement: true,
    vaultKeys: new Map([[1, key]]),
    activeVaultKeyVersion: 1,
    vaultPepper: 'pepper',
    auditInternalUrl: 'http://audit.internal',
    audioSink: 'discard',
    distortSemitones: 2,
    maxRecordingSeconds: 120,
    maxInboundChars: 1000,
    vaultTtlDays: 30,
    eventTtlHours: 24,
    audioTtlMinutes: 30,
    purgeIntervalMs: 60_000,
    relayIntervalMs: 60_000,
    ackAppends: true,
    inboundPerHashPerHour: 20,
    newCasesPerHashPerDay: 5,
    outboundPerCasePerHour: 10,
    outboundPerHashPerDay: 20,
    outboundPerMinute: 100,
    outboundMaxAttempts: 3,
    allowStubInjection: true,
    ...overrides,
  };
}

interface Fixture extends PipelineDeps {
  sent: Array<{ to: string; text: string; idempotencyKey: string }>;
  deliveries: Array<{ id: string; state: string; failureCode?: string }>;
  advance(ms: number): void;
}

function fixture(
  trace: Partial<TraceClient> = {},
  configOverrides: Partial<ChannelConfig> = {},
): Fixture {
  const sent: Array<{ to: string; text: string; idempotencyKey: string }> = [];
  const deliveries: Array<{ id: string; state: string; failureCode?: string }> = [];
  let currentNow = initialNow;
  return {
    sent,
    deliveries,
    advance(ms) {
      currentNow = new Date(currentNow.getTime() + ms);
    },
    config: config(configOverrides),
    store: new MemoryChannelStore(),
    provider: {
      name: 'stub',
      async sendSms(input) {
        sent.push(input);
        return { providerMessageId: `provider-${input.idempotencyKey}` };
      },
      async answerCall() {},
      async speak() {},
      async recordStart() {},
      async hangup() {},
      async listRecordings() {
        return [];
      },
      async fetchRecording() {
        return new Uint8Array();
      },
      async deleteRecording() {},
    },
    trace: {
      async createChannelCase() {
        return { case: { recordId: 'rec-1', caseNumber: 'VRS-1', reopenKey: 'rk', state: 'open' } };
      },
      async appendChannelMessage() {
        return { message: { id: 'msg-1' } };
      },
      async listOutbox() {
        return { messages: [] };
      },
      async markDelivery(id, input) {
        deliveries.push({ id, state: input.state, failureCode: input.failureCode });
      },
      ...trace,
    },
    audit: { async emit() {} },
    log() {},
    now: () => currentNow,
  };
}

async function seedIdentityAndLink(
  subject: PipelineDeps,
  blocked = false,
): Promise<{ hash: string; link: ChannelLink }> {
  const hash = phoneHash(phone, subject.config.vaultPepper, subject.config.municipalityId);
  const sealedPhone = sealString(key, phone, 'phone');
  const identity: ChannelIdentity = {
    phoneHash: hash,
    phoneCiphertext: sealedPhone.ciphertext,
    phoneNonce: sealedPhone.nonce,
    phoneTag: sealedPhone.tag,
    keyVersion: 1,
    municipalityId: subject.config.municipalityId,
    firstSeenAt: initialNow,
    lastSeenAt: initialNow,
    expiresAt: new Date(initialNow.getTime() + 1000),
    blocked,
  };
  await subject.store.upsertIdentity(identity);
  const sealedReopen = sealString(key, 'rk', 'reopen-key');
  const link: ChannelLink = {
    phoneHash: hash,
    recordId: 'rec-1',
    caseNumber: 'VRS-1',
    reopenKeyCiphertext: sealedReopen.ciphertext,
    reopenKeyNonce: sealedReopen.nonce,
    reopenKeyTag: sealedReopen.tag,
    keyVersion: 1,
    channel: 'sms',
    state: 'open',
    lastMessageAt: initialNow,
    expiresAt: new Date(initialNow.getTime() + 1000),
  };
  await subject.store.upsertLink(link);
  return { hash, link };
}

async function enqueue(
  subject: PipelineDeps,
  hash: string,
  sourceMessageId: string | null,
  text = 'provjera',
): Promise<ChannelOutbox> {
  const sealed = sealString(key, text, 'outbox-body');
  const row: ChannelOutbox = {
    id: `out-${sourceMessageId ?? 'confirmation'}`,
    sourceMessageId,
    recordId: 'rec-1',
    caseNumber: 'VRS-1',
    phoneHash: hash,
    bodyCiphertext: sealed.ciphertext,
    bodyNonce: sealed.nonce,
    bodyTag: sealed.tag,
    keyVersion: 1,
    origin: sourceMessageId ? 'relay' : 'confirmation',
    state: 'pending',
    providerMessageId: null,
    attempts: 0,
    nextAttemptAt: initialNow,
    lastError: null,
    sentAt: null,
    createdAt: initialNow,
    expiresAt: new Date(initialNow.getTime() + 1000),
  };
  await subject.store.enqueueOutbox(row);
  return row;
}

test('runRelayCycle marks a Trace message without a channel failed no_channel', async () => {
  const subject = fixture({
    async listOutbox() {
      return {
        messages: [
          {
            id: 'trace-1',
            recordId: 'missing',
            kind: 'sms',
            body: 'status',
            createdAt: initialNow.toISOString(),
          },
        ],
      };
    },
  });
  assert.deepEqual(await runRelayCycle(subject), { handedOff: 0, failed: 1, duplicates: 0 });
  assert.deepEqual(subject.deliveries, [
    { id: 'trace-1', state: 'failed', failureCode: 'no_channel' },
  ]);
});

test('runRelayCycle maps by record id and dedupes repeated source ids', async () => {
  const subject = fixture({
    async listOutbox() {
      return {
        messages: [
          {
            id: 'trace-1',
            recordId: 'rec-1',
            kind: 'sms',
            body: 'status',
            createdAt: initialNow.toISOString(),
          },
        ],
      };
    },
  });
  await seedIdentityAndLink(subject);
  assert.deepEqual(await runRelayCycle(subject), { handedOff: 1, failed: 0, duplicates: 0 });
  assert.deepEqual(await runRelayCycle(subject), { handedOff: 0, failed: 0, duplicates: 1 });
  const outbox = await subject.store.claimOutbox(initialNow, 1);
  assert.equal(
    openString(
      key,
      {
        ciphertext: Buffer.from(outbox[0]!.bodyCiphertext),
        nonce: Buffer.from(outbox[0]!.bodyNonce),
        tag: Buffer.from(outbox[0]!.bodyTag),
      },
      'outbox-body',
    ),
    'status',
  );
  assert.equal(
    subject.deliveries.some((ack) => /\+?\d{8,}/.test(JSON.stringify(ack))),
    false,
  );
});

test('deliverOutbound wraps relay copy but sends confirmation copy raw', async () => {
  const subject = fixture();
  const { hash } = await seedIdentityAndLink(subject);
  await enqueue(subject, hash, 'trace-relay', 'status');
  await enqueue(subject, hash, null, 'Prijava je zaprimljena. Broj predmeta: VRS-1.');
  assert.deepEqual(await deliverOutbound(subject), { sent: 2, deferred: 0, failed: 0 });
  assert.deepEqual(
    subject.sent.map((message) => message.text).sort(),
    ['Predmet VRS-1: status', 'Prijava je zaprimljena. Broj predmeta: VRS-1.'].sort(),
  );
  const redacted = subject.sent.map((message) => ({ ...message, to: '[redacted]' }));
  assert.equal(/\+?\d{8,}/.test(JSON.stringify(redacted)), false);
});

test('deliverOutbound defers caps without dropping the row', async () => {
  const subject = fixture({}, { outboundPerMinute: 0 });
  const { hash } = await seedIdentityAndLink(subject);
  await enqueue(subject, hash, 'trace-cap');
  assert.deepEqual(await deliverOutbound(subject), { sent: 0, deferred: 1, failed: 0 });
  assert.equal(subject.sent.length, 0);
  subject.advance(60_000);
  assert.equal((await subject.store.claimOutbox(subject.now(), 1)).length, 1);
});

test('provider failures back off, then terminate and fail the Trace delivery', async () => {
  const subject = fixture();
  subject.provider.sendSms = async () => {
    throw new Error('provider_down');
  };
  const { hash } = await seedIdentityAndLink(subject);
  await enqueue(subject, hash, 'trace-fail');
  assert.deepEqual(await deliverOutbound(subject), { sent: 0, deferred: 1, failed: 0 });
  subject.advance(60_000);
  assert.deepEqual(await deliverOutbound(subject), { sent: 0, deferred: 1, failed: 0 });
  subject.advance(60_000);
  assert.deepEqual(await deliverOutbound(subject), { sent: 0, deferred: 0, failed: 1 });
  assert.equal(
    subject.deliveries.some((item) => item.failureCode === 'provider_failed'),
    true,
  );
  subject.advance(60_000);
  assert.deepEqual(await subject.store.claimOutbox(subject.now(), 1), []);
  assert.equal((await subject.store.findOutboxBySource('trace-fail'))?.state, 'failed');
});

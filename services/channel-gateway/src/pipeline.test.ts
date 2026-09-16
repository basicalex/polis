// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChannelConfig } from './config.js';
import { openString, phoneHash, sealString } from './crypto.js';
import { MemoryChannelStore } from './memory-store.js';
import { handleDeliveryEvent, handleMessagingEvent, runInboxCycle } from './pipeline.js';
import type { PipelineDeps, TraceClient } from './pipeline-types.js';
import { deliverOutbound } from './relay.js';
import type { ChannelLink, ChannelOutbox } from './types.js';

const key = Buffer.alloc(32, 9);
const now = new Date('2026-09-12T12:00:00.000Z');
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
    appendWindowHours: 72,
    closedRetentionDays: 30,
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

function events(entries: Array<{ id: string; from: string; text: string }>): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      results: entries.map(({ id, from, text }) => ({
        messageId: id,
        from,
        to: '+385981234567',
        text,
        receivedAt: now.toISOString(),
      })),
      messageCount: entries.length,
      pendingMessageCount: 0,
    }),
  );
}

function event(id: string, from: string, text: string): Uint8Array {
  return events([{ id, from, text }]);
}

interface Fixture {
  deps: PipelineDeps;
  caseRequests: Array<{ text: string | null }>;
  appendRequests: Array<{ caseNumber: string; input: unknown }>;
  logs: string[];
  sentMessages: Array<{ to: string; text: string; idempotencyKey: string }>;
}

function fixture(
  traceOverrides: Partial<TraceClient> = {},
  configOverrides: Partial<ChannelConfig> = {},
): Fixture {
  const caseRequests: Array<{ text: string | null }> = [];
  const appendRequests: Array<{ caseNumber: string; input: unknown }> = [];
  const logs: string[] = [];
  const sentMessages: Array<{ to: string; text: string; idempotencyKey: string }> = [];
  const deps: PipelineDeps = {
    config: config(configOverrides),
    store: new MemoryChannelStore(),
    provider: {
      name: 'stub',
      async sendSms(input) {
        sentMessages.push(input);
        return { providerMessageId: 'stub-msg' };
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
      async createChannelCase(input) {
        caseRequests.push(input);
        return {
          case: { recordId: 'rec-1', caseNumber: 'VRS-1', reopenKey: 'rk-1', state: 'open' },
        };
      },
      async appendChannelMessage(caseNumber, input) {
        appendRequests.push({ caseNumber, input });
        return { message: { id: 'msg-1' } };
      },
      async listOutbox() {
        return { messages: [] };
      },
      async markDelivery() {},
      async readCaseClosure() {
        return null;
      },
      ...traceOverrides,
    },
    audit: { async emit() {} },
    log(fields) {
      logs.push(JSON.stringify(fields));
    },
    now: () => now,
  };
  return { deps, caseRequests, appendRequests, logs, sentMessages };
}

async function accept(subject: PipelineDeps, id: string, text: string): Promise<void> {
  const response = await handleMessagingEvent(event(id, phone, text), {}, subject, {
    stubInjection: true,
    scheduleProcessing: false,
  });
  assert.equal(response.status, 202);
}

async function seedLink(
  subject: PipelineDeps,
  {
    recordId = 'rec-existing',
    caseNumber = 'VRS-1',
    lastMessageAt = now,
  }: { recordId?: string; caseNumber?: string; lastMessageAt?: Date } = {},
): Promise<ChannelLink> {
  const hash = phoneHash(phone, subject.config.vaultPepper, subject.config.municipalityId);
  const sealed = sealString(key, `rk-${caseNumber}`, 'reopen-key');
  const link: ChannelLink = {
    phoneHash: hash,
    recordId,
    caseNumber,
    reopenKeyCiphertext: sealed.ciphertext,
    reopenKeyNonce: sealed.nonce,
    reopenKeyTag: sealed.tag,
    keyVersion: 1,
    channel: 'sms',
    state: 'open',
    closedAt: null,
    lastMessageAt,
    expiresAt: new Date(now.getTime() + 180 * 86_400_000),
  };
  await subject.store.upsertLink(link);
  return link;
}

test('handleMessagingEvent verifies signatures and dedupes accepted event ids', async () => {
  const infobip = fixture(
    {},
    {
      channelProvider: 'infobip',
      infobip: {
        baseUrl: 'https://account.api.infobip.com/',
        apiKey: 'key',
        webhookSecret: 'a-real-webhook-secret-at-least-32-characters',
        webhookSignatureHeader: 'x-hub-signature',
        sender: phone,
        callsConfigurationId: 'calls-1',
        ttsLanguage: 'hr',
      },
    },
  ).deps;
  assert.deepEqual(await handleMessagingEvent(event('evt-unauth', phone, 'Kvar'), {}, infobip), {
    status: 401,
    body: { error: 'invalid_signature' },
  });

  const stub = fixture().deps;
  await accept(stub, 'evt-1', 'Kvar');
  assert.deepEqual(
    await handleMessagingEvent(event('evt-1', phone, 'Kvar'), {}, stub, {
      stubInjection: true,
      scheduleProcessing: false,
    }),
    { status: 202, body: { accepted: true, duplicate: true } },
  );
});

test('multi-result SMS bodies enqueue and dedupe each result independently', async () => {
  const subject = fixture().deps;
  const raw = events([
    { id: 'evt-many-1', from: phone, text: 'Prva' },
    { id: 'evt-many-2', from: phone, text: 'Druga' },
  ]);
  assert.deepEqual(
    await handleMessagingEvent(raw, {}, subject, {
      stubInjection: true,
      scheduleProcessing: false,
    }),
    { status: 202, body: { accepted: true, duplicate: false } },
  );
  assert.equal((await subject.store.claimInbox(now, 10)).length, 2);
  assert.deepEqual(
    await handleMessagingEvent(raw, {}, subject, {
      stubInjection: true,
      scheduleProcessing: false,
    }),
    { status: 202, body: { accepted: true, duplicate: true } },
  );
});

test('delivery reports map delivered, failed, and pending groups', async () => {
  for (const [groupName, expected, name] of [
    ['DELIVERED', 'delivered', 'DELIVERED_TO_HANDSET'],
    ['REJECTED', 'failed', 'REJECTED_NETWORK'],
    ['PENDING', 'sent', 'PENDING_ENROUTE'],
  ] as const) {
    const subject = fixture();
    const sealed = sealString(key, 'Poruka', 'outbox-body');
    const sourceMessageId = `delivery-${groupName}`;
    const outbox: ChannelOutbox = {
      id: `11111111-1111-4111-8111-11111111111${groupName.length}`,
      sourceMessageId,
      recordId: '22222222-2222-4222-8222-222222222222',
      caseNumber: 'VRS-1',
      phoneHash: 'a'.repeat(64),
      bodyCiphertext: sealed.ciphertext,
      bodyNonce: sealed.nonce,
      bodyTag: sealed.tag,
      keyVersion: 1,
      origin: 'confirmation',
      state: 'pending',
      providerMessageId: null,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      sentAt: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    await subject.deps.store.enqueueOutbox(outbox);
    await subject.deps.store.markOutboxSent(outbox.id, 'provider-message-1', now);
    const raw = Buffer.from(
      JSON.stringify({
        results: [
          {
            messageId: 'provider-message-1',
            to: phone,
            sentAt: now.toISOString(),
            doneAt: now.toISOString(),
            status: { groupId: 1, groupName, id: 1, name },
            error: {},
          },
        ],
      }),
    );
    assert.equal(
      (
        await handleDeliveryEvent(raw, {}, subject.deps, {
          stubInjection: true,
          scheduleProcessing: false,
        })
      ).status,
      202,
    );
    const stored = await subject.deps.store.findOutboxBySource(sourceMessageId);
    assert.equal(stored?.state, expected);
    assert.equal(stored?.lastError, groupName === 'REJECTED' ? name : null);
  }
});

test('runInboxCycle creates a case and confirms only after Trace returns it', async () => {
  const subject = fixture();
  await accept(subject.deps, 'evt-create', 'Rupa u cesti');
  assert.deepEqual(await subject.deps.store.claimOutbox(now, 5), []);
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
  assert.equal(subject.caseRequests.length, 1);
  const hash = phoneHash(
    phone,
    subject.deps.config.vaultPepper,
    subject.deps.config.municipalityId,
  );
  assert.equal((await subject.deps.store.findLinkByRecord('rec-1'))?.phoneHash, hash);
  const outbox = await subject.deps.store.claimOutbox(now, 5);
  assert.equal(outbox.length, 1);
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
    'Prijava je zaprimljena. Broj predmeta: VRS-1.',
  );
});

test('plain text appends to the most recent link inside the append window', async () => {
  const subject = fixture();
  await seedLink(subject.deps, {
    lastMessageAt: new Date(now.getTime() - 71 * 3_600_000),
  });
  await accept(subject.deps, 'evt-inside-window', 'Dodatak prijavi');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
  assert.equal(subject.appendRequests.length, 1);
  assert.equal(subject.caseRequests.length, 0);
});

test('plain text creates a new case outside the append window', async () => {
  const subject = fixture();
  const oldLink = await seedLink(subject.deps, {
    recordId: 'rec-old',
    lastMessageAt: new Date(now.getTime() - 73 * 3_600_000),
  });
  await accept(subject.deps, 'evt-outside-window', 'Nova prijava bez ključne riječi');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
  assert.equal(subject.caseRequests.length, 1);
  assert.equal(subject.appendRequests.length, 0);
  const links = await subject.deps.store.listOpenLinks(oldLink.phoneHash);
  assert.deepEqual(links.map((link) => link.recordId).sort(), ['rec-1', 'rec-old']);
});

test('NOVA in capitals forces a new case and strips only the leading keyword', async () => {
  for (const [index, text, expected] of [
    [1, 'NOVA Rupa na Rivi', 'Rupa na Rivi'],
    [2, 'NOVA: tekst', 'tekst'],
  ] as const) {
    const subject = fixture();
    await seedLink(subject.deps);
    await accept(subject.deps, `evt-nova-${index}`, text);
    assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
    assert.equal(subject.caseRequests[0]?.text, expected);
    assert.equal(subject.appendRequests.length, 0);
  }
});

test('nova written as an ordinary word appends with the text unchanged', async () => {
  for (const [index, text] of [
    [1, 'Nova rupa na Rivi'],
    [2, 'nova rupa'],
    [3, 'Novak je tu'],
  ] as const) {
    const subject = fixture();
    await seedLink(subject.deps);
    await accept(subject.deps, `evt-nova-word-${index}`, text);
    assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
    assert.equal(subject.appendRequests.length, 1);
    assert.equal((subject.appendRequests[0]?.input as { text: string }).text, text);
    assert.equal(subject.caseRequests.length, 0);
  }
});

test('case-number targeting wins outside the append window', async () => {
  const subject = fixture();
  await seedLink(subject.deps, {
    lastMessageAt: new Date(now.getTime() - 10 * 86_400_000),
  });
  await accept(subject.deps, 'evt-target-stale', 'VRS-1 dodatak');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
  assert.equal(subject.appendRequests[0]?.caseNumber, 'VRS-1');
  assert.equal(subject.caseRequests.length, 0);
});

test('bare NOVA keeps a non-empty narrative while forcing a new case', async () => {
  const subject = fixture();
  await seedLink(subject.deps);
  await accept(subject.deps, 'evt-bare-nova', 'NOVA');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
  assert.equal(subject.caseRequests[0]?.text, 'NOVA');
  assert.equal(subject.appendRequests.length, 0);
});

test('multi-link prefix selects the owned case and append acknowledgement names it', async () => {
  const subject = fixture();
  const hash = phoneHash(
    phone,
    subject.deps.config.vaultPepper,
    subject.deps.config.municipalityId,
  );
  for (const [recordId, caseNumber] of [
    ['rec-old', 'VRS-1'],
    ['rec-new', 'VRS-2'],
  ] as const) {
    const sealed = sealString(key, `rk-${caseNumber}`, 'reopen-key');
    const link: ChannelLink = {
      phoneHash: hash,
      recordId,
      caseNumber,
      reopenKeyCiphertext: sealed.ciphertext,
      reopenKeyNonce: sealed.nonce,
      reopenKeyTag: sealed.tag,
      keyVersion: 1,
      channel: 'sms',
      state: 'open',
      closedAt: null,
      lastMessageAt: now,
      expiresAt: new Date(now.getTime() + 1000),
    };
    await subject.deps.store.upsertLink(link);
  }
  await accept(subject.deps, 'evt-append', 'VRS-1: dodatak prijavi');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 1, failed: 0 });
  assert.equal(subject.appendRequests[0]?.caseNumber, 'VRS-1');
  const outbox = await subject.deps.store.claimOutbox(now, 1);
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
    'Poruka je dodana predmetu VRS-1.',
  );
});

test('STOP blocks once, blocked messages are ignored, and POČNI unblocks', async () => {
  const subject = fixture();
  await accept(subject.deps, 'evt-stop', 'STOP');
  const hash = phoneHash(
    phone,
    subject.deps.config.vaultPepper,
    subject.deps.config.municipalityId,
  );
  assert.equal((await subject.deps.store.getIdentity(hash))?.blocked, true);
  await accept(subject.deps, 'evt-blocked', 'Ovo se ne obrađuje');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 0, failed: 0 });
  assert.deepEqual(await deliverOutbound(subject.deps), { sent: 1, deferred: 0, failed: 0 });
  assert.deepEqual(
    subject.sentMessages.map((message) => message.text),
    ['Poruke su zaustavljene. Pošaljite POČNI za nastavak.'],
  );
  await accept(subject.deps, 'evt-start', 'POČNI');
  assert.equal((await subject.deps.store.getIdentity(hash))?.blocked, false);
});

test('inbound and new-case caps complete without creating or confirming excess work', async () => {
  const inbound = fixture({}, { inboundPerHashPerHour: 1 });
  await accept(inbound.deps, 'evt-limit-1', 'Prva prijava');
  await accept(inbound.deps, 'evt-limit-2', 'Druga prijava');
  assert.deepEqual(await runInboxCycle(inbound.deps), { processed: 2, failed: 0 });
  assert.equal(inbound.caseRequests.length, 1);
  assert.equal((await inbound.deps.store.claimOutbox(now, 5)).length, 1);

  const newCases = fixture({}, { newCasesPerHashPerDay: 1 });
  await accept(newCases.deps, 'evt-case-1', 'Prva prijava');
  await runInboxCycle(newCases.deps);
  const hash = phoneHash(
    phone,
    newCases.deps.config.vaultPepper,
    newCases.deps.config.municipalityId,
  );
  const link = await newCases.deps.store.findLinkByRecord('rec-1');
  assert.ok(link);
  await newCases.deps.store.closeLink(hash, link.recordId, {
    closedAt: now,
    expiresAt: new Date(now.getTime() + 30 * 86_400_000),
  });
  await accept(newCases.deps, 'evt-case-2', 'Druga prijava');
  await runInboxCycle(newCases.deps);
  assert.equal(newCases.caseRequests.length, 1);
  assert.equal((await newCases.deps.store.claimOutbox(now, 5)).length, 1);
});

test('Trace failure backs off and does not enqueue confirmation before a case exists', async () => {
  const subject = fixture({
    async createChannelCase() {
      throw new Error('trace unavailable');
    },
  });
  await accept(subject.deps, 'evt-failure', 'Rupa u cesti');
  assert.deepEqual(await runInboxCycle(subject.deps), { processed: 0, failed: 1 });
  assert.deepEqual(await subject.deps.store.claimOutbox(now, 5), []);
  assert.deepEqual(await subject.deps.store.claimInbox(new Date(now.getTime() + 119_999), 5), []);
  assert.equal(
    (await subject.deps.store.claimInbox(new Date(now.getTime() + 120_000), 5)).length,
    1,
  );
  assert.equal(
    subject.logs.some((line) => /\+?\d{8,}/.test(line)),
    false,
  );
});

test('best-effort audit cannot delay the messaging acknowledgement', async () => {
  const subject = fixture();
  const auditThenable = {
    then() {
      throw new Error('audit promise was awaited');
    },
    catch() {
      return auditThenable;
    },
  };
  // Deliberately incomplete thenable: awaiting it throws, while fire-and-forget `.catch` is safe.
  subject.deps.audit.emit = () => auditThenable as unknown as Promise<void>;
  const outcome = await handleMessagingEvent(
    event('evt-slow-audit', phone, 'Rupa u cesti'),
    {},
    subject.deps,
    { stubInjection: true, scheduleProcessing: false },
  );
  assert.equal(outcome.status, 202);
});

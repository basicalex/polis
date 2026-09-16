// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { ChannelConfig } from './config.js';
import type { LogFields } from './log.js';
import { MemoryChannelStore } from './memory-store.js';
import type { PipelineDeps, TraceCaseClosure } from './pipeline-types.js';
import { purgeExpired, runRetentionCycle, sweepCaseClosures } from './retention.js';
import type {
  ChannelCall,
  ChannelIdentity,
  ChannelInbox,
  ChannelLink,
  ChannelOutbox,
  ChannelRecording,
} from './types.js';

const old = new Date('2020-01-01T00:00:00.000Z');
const expired = new Date('2020-02-01T00:00:00.000Z');
const now = new Date('2021-01-01T00:00:00.000Z');
const future = new Date('2030-01-01T00:00:00.000Z');
const sealed = new Uint8Array([1]);

function identity(phoneHash: string, expiresAt: Date): ChannelIdentity {
  return {
    phoneHash,
    phoneCiphertext: sealed,
    phoneNonce: new Uint8Array(12),
    phoneTag: new Uint8Array(16),
    keyVersion: 1,
    municipalityId: 'vrsar-orsera',
    firstSeenAt: old,
    lastSeenAt: old,
    expiresAt,
    blocked: false,
  };
}

function link(
  phoneHash: string,
  expiresAt: Date,
  overrides: Partial<ChannelLink> = {},
): ChannelLink {
  return {
    phoneHash,
    recordId: randomUUID(),
    caseNumber: `CASE-${randomUUID()}`,
    reopenKeyCiphertext: sealed,
    reopenKeyNonce: new Uint8Array(12),
    reopenKeyTag: new Uint8Array(16),
    keyVersion: 1,
    channel: 'voice',
    state: 'open',
    lastMessageAt: old,
    closedAt: null,
    expiresAt,
    ...overrides,
  };
}

interface ClosureFixture {
  deps: PipelineDeps;
  store: MemoryChannelStore;
  answers: Map<string, TraceCaseClosure | null | Error>;
  logs: LogFields[];
  setNow(value: Date): void;
}

function closureFixture(initialNow: Date): ClosureFixture {
  let currentNow = initialNow;
  const store = new MemoryChannelStore(() => currentNow);
  const answers = new Map<string, TraceCaseClosure | null | Error>();
  const logs: LogFields[] = [];
  const config: ChannelConfig = {
    internalApiToken: 'token',
    databaseUrl: 'memory',
    traceInternalUrl: 'http://trace.internal',
    traceGatewayActorId: 'channel-gateway',
    municipalityId: 'vrsar-orsera',
    deploymentProfile: 'dev',
    channelProvider: 'stub',
    sttProvider: 'stub',
    processingAgreement: true,
    vaultKeys: new Map([[1, Buffer.alloc(32, 1)]]),
    activeVaultKeyVersion: 1,
    vaultPepper: 'pepper',
    auditInternalUrl: 'http://audit.internal',
    audioSink: 'discard',
    distortSemitones: 2,
    maxRecordingSeconds: 120,
    maxInboundChars: 1000,
    appendWindowHours: 72,
    closedRetentionDays: 30,
    vaultTtlDays: 180,
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
  };
  const deps: PipelineDeps = {
    config,
    store,
    provider: {
      name: 'stub',
      async sendSms() {
        return { providerMessageId: 'message-1' };
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
        return {
          case: {
            recordId: 'record-1',
            caseNumber: 'CASE-1',
            reopenKey: 'reopen-1',
            state: 'received',
          },
        };
      },
      async appendChannelMessage() {
        return { message: { id: 'message-1' } };
      },
      async readCaseClosure(caseNumber) {
        const answer = answers.get(caseNumber);
        if (answer instanceof Error) throw answer;
        return answer ?? null;
      },
      async listOutbox() {
        return { messages: [] };
      },
      async markDelivery() {},
    },
    audit: { async emit() {} },
    log(fields) {
      logs.push(fields);
    },
    now: () => currentNow,
  };
  return {
    deps,
    store,
    answers,
    logs,
    setNow(value) {
      currentNow = value;
    },
  };
}

test('retention purges every expired class and preserves identities with live links', async () => {
  const store = new MemoryChannelStore(() => old);
  const removableHash = 'a'.repeat(64);
  const linkedHash = 'b'.repeat(64);
  await store.upsertIdentity(identity(removableHash, expired));
  await store.upsertIdentity(identity(linkedHash, expired));
  await store.upsertLink(link(removableHash, expired));
  await store.upsertLink(link(linkedHash, future));
  await store.recordEvent('infobip', 'expired-event', 'sms.received', 'c'.repeat(64));
  const call: ChannelCall = {
    callId: 'expired-call',
    phoneHash: removableHash,
    caseNumber: null,
    recordId: null,
    step: 'answered',
    createdAt: old,
    updatedAt: old,
    expiresAt: expired,
  };
  await store.upsertCall(call);

  const inbox: ChannelInbox = {
    id: randomUUID(),
    providerEventId: 'expired-inbox',
    kind: 'voice_recording',
    phoneHash: removableHash,
    bodyCiphertext: null,
    bodyNonce: null,
    bodyTag: null,
    keyVersion: null,
    providerRef: null,
    callControlId: 'call-1',
    state: 'done',
    attempts: 1,
    nextAttemptAt: old,
    lastError: null,
    recordId: null,
    caseNumber: null,
    createdAt: old,
    expiresAt: expired,
  };
  await store.enqueueInbox(inbox);

  const outbox: ChannelOutbox = {
    id: randomUUID(),
    sourceMessageId: 'expired-outbox',
    recordId: randomUUID(),
    caseNumber: 'CASE-EXPIRED',
    phoneHash: removableHash,
    bodyCiphertext: sealed,
    bodyNonce: new Uint8Array(12),
    bodyTag: new Uint8Array(16),
    keyVersion: 1,
    origin: 'system',
    state: 'delivered',
    providerMessageId: 'message-1',
    attempts: 1,
    nextAttemptAt: old,
    lastError: null,
    sentAt: old,
    createdAt: old,
    expiresAt: expired,
  };
  await store.enqueueOutbox(outbox);

  const recording: ChannelRecording = {
    id: randomUUID(),
    providerRecordingId: 'expired-recording',
    inboxId: inbox.id,
    state: 'discarded',
    distortedSha256: null,
    bytes: null,
    createdAt: old,
    expiresAt: expired,
  };
  await store.putRecording(recording);

  assert.deepEqual(await purgeExpired(store, now), {
    events: 1,
    inbox: 1,
    outbox: 1,
    recordings: 1,
    calls: 1,
    links: 1,
    identities: 1,
  });
  assert.equal(await store.getIdentity(removableHash), null);
  assert.ok(await store.getIdentity(linkedHash));
  assert.equal((await store.listOpenLinks(linkedHash)).length, 1);
  assert.equal(await store.findOutboxBySource('expired-outbox'), null);
  assert.equal(await store.getRecording(recording.id), null);
  assert.equal(await store.getCall(call.callId), null);
});

test('closure sweep closes resolved links and caps identities only without another open link', async () => {
  const terminalAt = new Date('2026-01-01T00:00:00.000Z');
  const expectedExpiry = new Date(terminalAt.getTime() + 30 * 86_400_000);
  const subject = closureFixture(terminalAt);
  const cappedHash = 'c'.repeat(64);
  const sharedHash = 'd'.repeat(64);
  const cappedLink = link(cappedHash, future, {
    recordId: 'record-capped',
    caseNumber: 'CASE-CAPPED',
  });
  const sharedClosedLink = link(sharedHash, future, {
    recordId: 'record-shared-closed',
    caseNumber: 'CASE-SHARED-CLOSED',
  });
  const sharedOpenLink = link(sharedHash, future, {
    recordId: 'record-shared-open',
    caseNumber: 'CASE-SHARED-OPEN',
  });
  await subject.store.upsertIdentity(identity(cappedHash, future));
  await subject.store.upsertIdentity(identity(sharedHash, future));
  await subject.store.upsertLink(cappedLink);
  await subject.store.upsertLink(sharedClosedLink);
  await subject.store.upsertLink(sharedOpenLink);
  subject.answers.set(cappedLink.caseNumber, {
    state: 'resolved',
    terminalAt: terminalAt.toISOString(),
  });
  subject.answers.set(sharedClosedLink.caseNumber, {
    state: 'resolved',
    terminalAt: terminalAt.toISOString(),
  });
  subject.answers.set(sharedOpenLink.caseNumber, { state: 'answered', terminalAt: null });

  assert.deepEqual(await sweepCaseClosures(subject.deps), {
    closed: 2,
    reopened: 0,
    skipped: 0,
  });
  const capped = await subject.store.findLinkByRecord(cappedLink.recordId);
  assert.equal(capped?.state, 'closed');
  assert.equal(capped?.closedAt?.toISOString(), terminalAt.toISOString());
  assert.equal(capped?.expiresAt.toISOString(), expectedExpiry.toISOString());
  assert.equal(
    (await subject.store.getIdentity(cappedHash))?.expiresAt.toISOString(),
    expectedExpiry.toISOString(),
  );
  assert.equal(
    (await subject.store.getIdentity(sharedHash))?.expiresAt.toISOString(),
    future.toISOString(),
  );
});

test('closed links and identities purge at retention while open cases remain', async () => {
  const terminalAt = new Date('2026-02-01T00:00:00.000Z');
  const subject = closureFixture(terminalAt);
  const closedHash = 'a'.repeat(64);
  const openHash = 'b'.repeat(64);
  const resolved = link(closedHash, future, {
    recordId: 'record-resolved',
    caseNumber: 'CASE-RESOLVED',
  });
  const open = link(openHash, future, {
    recordId: 'record-open',
    caseNumber: 'CASE-OPEN',
  });
  await subject.store.upsertIdentity(identity(closedHash, future));
  await subject.store.upsertIdentity(identity(openHash, future));
  await subject.store.upsertLink(resolved);
  await subject.store.upsertLink(open);
  subject.answers.set(resolved.caseNumber, {
    state: 'resolved',
    terminalAt: terminalAt.toISOString(),
  });
  subject.answers.set(open.caseNumber, { state: 'answered', terminalAt: null });

  await sweepCaseClosures(subject.deps);
  const expiry = new Date(terminalAt.getTime() + 30 * 86_400_000);
  await purgeExpired(subject.store, new Date(expiry.getTime() - 60_000));
  assert.ok(await subject.store.findLinkByRecord(resolved.recordId));
  assert.ok(await subject.store.findLinkByRecord(open.recordId));

  const counts = await purgeExpired(subject.store, expiry);
  assert.equal(counts.links, 1);
  assert.equal(counts.identities, 1);
  assert.equal(await subject.store.findLinkByRecord(resolved.recordId), null);
  assert.equal(await subject.store.getIdentity(closedHash), null);
  assert.ok(await subject.store.findLinkByRecord(open.recordId));
  assert.ok(await subject.store.getIdentity(openHash));
});

test('closure sweep preserves an earlier vault ceiling', async () => {
  const terminalAt = new Date('2026-03-01T00:00:00.000Z');
  const earlierExpiry = new Date(terminalAt.getTime() + 10 * 86_400_000);
  const subject = closureFixture(terminalAt);
  const phoneHash = 'e'.repeat(64);
  const target = link(phoneHash, earlierExpiry, {
    recordId: 'record-ceiling',
    caseNumber: 'CASE-CEILING',
  });
  await subject.store.upsertIdentity(identity(phoneHash, future));
  await subject.store.upsertLink(target);
  subject.answers.set(target.caseNumber, {
    state: 'resolved',
    terminalAt: terminalAt.toISOString(),
  });

  await sweepCaseClosures(subject.deps);
  assert.equal(
    (await subject.store.findLinkByRecord(target.recordId))?.expiresAt.toISOString(),
    earlierExpiry.toISOString(),
  );
});

test('closure sweep reopens a non-terminal case to the vault ceiling', async () => {
  const current = new Date('2026-04-01T00:00:00.000Z');
  const subject = closureFixture(current);
  const phoneHash = 'f'.repeat(64);
  const previousExpiry = new Date(current.getTime() + 10 * 86_400_000);
  const target = link(phoneHash, previousExpiry, {
    recordId: 'record-reopened',
    caseNumber: 'CASE-REOPENED',
    state: 'closed',
    closedAt: new Date('2026-03-01T00:00:00.000Z'),
  });
  await subject.store.upsertIdentity(identity(phoneHash, previousExpiry));
  await subject.store.upsertLink(target);
  subject.answers.set(target.caseNumber, { state: 'disputed', terminalAt: null });

  assert.deepEqual(await sweepCaseClosures(subject.deps), {
    closed: 0,
    reopened: 1,
    skipped: 0,
  });
  const expectedExpiry = new Date(current.getTime() + 180 * 86_400_000);
  const reopened = await subject.store.findLinkByRecord(target.recordId);
  assert.equal(reopened?.state, 'open');
  assert.equal(reopened?.closedAt, null);
  assert.equal(reopened?.expiresAt.toISOString(), expectedExpiry.toISOString());
  assert.equal(
    (await subject.store.getIdentity(phoneHash))?.expiresAt.toISOString(),
    expectedExpiry.toISOString(),
  );
});

test('closure sweep skips unknown and failed trace reads without logging private values', async () => {
  const subject = closureFixture(new Date('2026-05-01T00:00:00.000Z'));
  const unknownHash = '1'.repeat(64);
  const failedHash = '2'.repeat(64);
  const unknown = link(unknownHash, future, {
    recordId: 'record-unknown',
    caseNumber: 'CASE-UNKNOWN',
  });
  const failed = link(failedHash, future, {
    recordId: 'record-failed',
    caseNumber: 'CASE-FAILED',
  });
  await subject.store.upsertLink(unknown);
  await subject.store.upsertLink(failed);
  subject.answers.set(unknown.caseNumber, null);
  subject.answers.set(failed.caseNumber, new Error('trace unavailable'));

  assert.deepEqual(await sweepCaseClosures(subject.deps), {
    closed: 0,
    reopened: 0,
    skipped: 2,
  });
  assert.equal((await subject.store.findLinkByRecord(unknown.recordId))?.state, 'open');
  assert.equal((await subject.store.findLinkByRecord(failed.recordId))?.state, 'open');
  assert.deepEqual(
    subject.logs.map((entry) => entry.code),
    ['closure_unknown', 'closure_unknown'],
  );
  const logText = JSON.stringify(subject.logs);
  assert.equal(logText.includes(unknownHash), false);
  assert.equal(logText.includes(failedHash), false);
  assert.equal(logText.includes('+385911111111'), false);
});

test('runRetentionCycle reports the sweep and purges newly expired closure data', async () => {
  const current = new Date('2026-06-01T00:00:00.000Z');
  const terminalAt = new Date(current.getTime() - 30 * 86_400_000);
  const subject = closureFixture(current);
  const phoneHash = '3'.repeat(64);
  const target = link(phoneHash, future, {
    recordId: 'record-cycle',
    caseNumber: 'CASE-CYCLE',
  });
  await subject.store.upsertIdentity(identity(phoneHash, future));
  await subject.store.upsertLink(target);
  subject.answers.set(target.caseNumber, {
    state: 'resolved',
    terminalAt: terminalAt.toISOString(),
  });

  assert.deepEqual(await runRetentionCycle(subject.deps), {
    sweep: { closed: 1, reopened: 0, skipped: 0 },
    purged: {
      events: 0,
      inbox: 0,
      outbox: 0,
      recordings: 0,
      calls: 0,
      links: 1,
      identities: 1,
    },
  });
  assert.equal(await subject.store.findLinkByRecord(target.recordId), null);
  assert.equal(await subject.store.getIdentity(phoneHash), null);
});

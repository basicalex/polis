// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { MemoryChannelStore } from './memory-store.js';
import { purgeExpired } from './retention.js';
import type {
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

function link(phoneHash: string, expiresAt: Date): ChannelLink {
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
    expiresAt,
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
  await store.recordEvent('telnyx', 'expired-event', 'message.received', 'c'.repeat(64));

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
    links: 1,
    identities: 1,
  });
  assert.equal(await store.getIdentity(removableHash), null);
  assert.ok(await store.getIdentity(linkedHash));
  assert.equal((await store.listOpenLinks(linkedHash)).length, 1);
  assert.equal(await store.findOutboxBySource('expired-outbox'), null);
  assert.equal(await store.getRecording(recording.id), null);
});

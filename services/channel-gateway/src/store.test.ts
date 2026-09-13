// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';

import { MemoryChannelStore } from './memory-store.js';
import { runChannelMigrations } from './migrations.js';
import { PostgresChannelStore } from './repository.js';
import type { ChannelStore } from './store.js';
import type {
  ChannelCall,
  ChannelIdentity,
  ChannelInbox,
  ChannelLink,
  ChannelOutbox,
  ChannelRecording,
} from './types.js';

const bytes = new Uint8Array([1, 2, 3]);

interface FixtureState {
  now: Date;
  phoneHash: string;
  identity: ChannelIdentity;
  link: ChannelLink;
  call: ChannelCall;
  inbox: ChannelInbox;
  outbox: ChannelOutbox;
  recording: ChannelRecording;
}

interface ConformanceState extends FixtureState {
  eventId: string;
}

function fixtures(): FixtureState {
  const now = new Date('2026-09-12T12:00:00.000Z');
  const future = new Date('2027-09-12T12:00:00.000Z');
  const phoneHash = randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64);
  const identity: ChannelIdentity = {
    phoneHash,
    phoneCiphertext: bytes,
    phoneNonce: new Uint8Array(12),
    phoneTag: new Uint8Array(16),
    keyVersion: 2,
    municipalityId: 'vrsar-orsera',
    firstSeenAt: now,
    lastSeenAt: now,
    expiresAt: future,
    blocked: false,
  };
  const link: ChannelLink = {
    phoneHash,
    recordId: randomUUID(),
    caseNumber: `CASE-${randomUUID()}`,
    reopenKeyCiphertext: bytes,
    reopenKeyNonce: new Uint8Array(12),
    reopenKeyTag: new Uint8Array(16),
    keyVersion: 2,
    channel: 'sms',
    state: 'open',
    lastMessageAt: now,
    expiresAt: future,
  };
  const call: ChannelCall = {
    callId: `call-${randomUUID()}`,
    phoneHash,
    caseNumber: link.caseNumber,
    recordId: link.recordId,
    step: 'prompt',
    createdAt: now,
    updatedAt: now,
    expiresAt: future,
  };
  const inbox: ChannelInbox = {
    id: randomUUID(),
    providerEventId: `event-${randomUUID()}`,
    kind: 'sms_inbound',
    phoneHash,
    bodyCiphertext: bytes,
    bodyNonce: new Uint8Array(12),
    bodyTag: new Uint8Array(16),
    keyVersion: 2,
    providerRef: 'provider-ref',
    callControlId: null,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    recordId: null,
    caseNumber: null,
    createdAt: now,
    expiresAt: future,
  };
  const outbox: ChannelOutbox = {
    id: randomUUID(),
    sourceMessageId: `source-${randomUUID()}`,
    recordId: link.recordId,
    caseNumber: link.caseNumber,
    phoneHash,
    bodyCiphertext: bytes,
    bodyNonce: new Uint8Array(12),
    bodyTag: new Uint8Array(16),
    keyVersion: 2,
    origin: 'relay',
    state: 'pending',
    providerMessageId: null,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    sentAt: null,
    createdAt: now,
    expiresAt: future,
  };
  const recording: ChannelRecording = {
    id: randomUUID(),
    providerRecordingId: `recording-${randomUUID()}`,
    inboxId: inbox.id,
    state: 'fetched',
    distortedSha256: null,
    bytes,
    createdAt: now,
    expiresAt: future,
  };
  return { now, phoneHash, identity, link, call, inbox, outbox, recording };
}

async function assertConformance(store: ChannelStore): Promise<ConformanceState> {
  const value = fixtures();
  await store.ping();
  await store.upsertIdentity(value.identity);
  assert.equal((await store.getIdentity(value.phoneHash))?.blocked, false);
  await store.setBlocked(value.phoneHash, true);
  assert.equal((await store.getIdentity(value.phoneHash))?.blocked, true);
  await store.setBlocked(value.phoneHash, false);

  await store.upsertLink(value.link);
  assert.equal((await store.listOpenLinks(value.phoneHash))[0]?.recordId, value.link.recordId);
  await store.closeLink(value.phoneHash, value.link.recordId);
  assert.deepEqual(await store.listOpenLinks(value.phoneHash), []);
  await store.upsertLink(value.link);
  await store.upsertCall(value.call);
  assert.equal((await store.getCall(value.call.callId))?.step, 'prompt');
  const callUpdatedAt = new Date(value.now.getTime() + 500);
  await store.markCallStep(value.call.callId, 'recording', callUpdatedAt);
  assert.equal((await store.getCall(value.call.callId))?.step, 'recording');
  assert.equal(
    (await store.getCall(value.call.callId))?.updatedAt.getTime(),
    callUpdatedAt.getTime(),
  );

  const eventId = `event-${randomUUID()}`;
  const eventHash = 'a'.repeat(64);
  assert.deepEqual(await store.recordEvent('infobip', eventId, 'sms.received', eventHash), {
    duplicate: false,
  });
  assert.deepEqual(await store.recordEvent('infobip', eventId, 'sms.received', eventHash), {
    duplicate: true,
  });
  await store.markEvent('infobip', eventId, 'processed');

  await store.enqueueInbox(value.inbox);
  await store.enqueueInbox({ ...value.inbox, id: randomUUID() });
  const firstInboxClaim = await store.claimInbox(value.now, 10);
  assert.equal(firstInboxClaim.length, 1);
  assert.equal(firstInboxClaim[0]?.state, 'processing');
  assert.equal(firstInboxClaim[0]?.attempts, 1);
  const retryAt = new Date(value.now.getTime() + 1_000);
  await store.failInbox(value.inbox.id, 'temporary', retryAt);
  assert.deepEqual(await store.claimInbox(value.now, 10), []);
  assert.equal((await store.claimInbox(retryAt, 10))[0]?.attempts, 2);
  await store.completeInbox(value.inbox.id, {
    recordId: value.link.recordId,
    caseNumber: value.link.caseNumber,
  });
  assert.deepEqual(await store.claimInbox(new Date(retryAt.getTime() + 1), 10), []);

  await store.enqueueOutbox(value.outbox);
  await store.enqueueOutbox({ ...value.outbox, id: randomUUID() });
  const outboxClaim = await store.claimOutbox(value.now, 10);
  assert.equal(outboxClaim.length, 1);
  assert.equal(outboxClaim[0]?.attempts, 1);
  assert.equal(
    (await store.findOutboxBySource(value.outbox.sourceMessageId!))?.id,
    value.outbox.id,
  );
  const sentAt = new Date(value.now.getTime() + 2_000);
  await store.markOutboxSent(value.outbox.id, 'provider-message-1', sentAt);
  await store.markOutboxDelivery('provider-message-1', 'delivered');
  assert.equal((await store.findOutboxBySource(value.outbox.sourceMessageId!))?.state, 'delivered');

  await store.putRecording(value.recording);
  assert.equal((await store.getRecording(value.recording.id))?.state, 'fetched');
  await store.updateRecording(value.recording.id, {
    state: 'distorted',
    distortedSha256: 'b'.repeat(64),
    bytes: null,
  });
  const changedRecording = await store.getRecording(value.recording.id);
  assert.equal(changedRecording?.state, 'distorted');
  assert.equal(changedRecording?.bytes, null);

  assert.equal(await store.bumpRate('inbound-hour', value.phoneHash, value.now), 1);
  assert.equal(await store.bumpRate('inbound-hour', value.phoneHash, value.now), 2);
  return { ...value, eventId };
}

test('MemoryChannelStore conforms to the shared channel contract', async () => {
  await assertConformance(new MemoryChannelStore());
});

const postgresDatabaseUrl = process.env.DATABASE_URL;
if (postgresDatabaseUrl) {
  test(
    'PostgresChannelStore conforms when DATABASE_URL is explicit',
    { timeout: 120_000 },
    async () => {
      await runChannelMigrations(postgresDatabaseUrl);
      const repository = new PostgresChannelStore(postgresDatabaseUrl);
      const sql = postgres(postgresDatabaseUrl, { prepare: false, onnotice: () => undefined });
      let value: ConformanceState | undefined;
      try {
        value = await assertConformance(repository);
      } finally {
        if (value) {
          await sql`DELETE FROM channel_recordings WHERE id = ${value.recording.id}`;
          await sql`DELETE FROM channel_inbox WHERE id = ${value.inbox.id}`;
          await sql`DELETE FROM channel_outbox WHERE id = ${value.outbox.id}`;
          await sql`DELETE FROM channel_calls WHERE call_id = ${value.call.callId}`;
          await sql`DELETE FROM channel_links WHERE phone_hash = ${value.phoneHash}`;
          await sql`DELETE FROM channel_identities WHERE phone_hash = ${value.phoneHash}`;
          await sql`DELETE FROM channel_events WHERE provider = 'infobip' AND event_id = ${value.eventId}`;
          await sql`DELETE FROM channel_rate_windows WHERE scope = 'inbound-hour' AND key = ${value.phoneHash}`;
        }
        await repository.close();
        await sql.end({ timeout: 5 });
      }
    },
  );
}

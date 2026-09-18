// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelStore } from './store.js';
import type {
  CallStep,
  ChannelCall,
  ChannelDecryption,
  ChannelEvent,
  ChannelIdentity,
  ChannelInbox,
  ChannelLink,
  ChannelOutbox,
  ChannelRecording,
  EventState,
  InboxCompletion,
  LinkClosure,
  OutboxState,
  PurgeCounts,
  RecordingUpdate,
} from './types.js';

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function copyOptionalBytes(value: Uint8Array | null): Uint8Array | null {
  return value ? copyBytes(value) : null;
}

function copyIdentity(value: ChannelIdentity): ChannelIdentity {
  return {
    ...value,
    phoneCiphertext: copyBytes(value.phoneCiphertext),
    phoneNonce: copyBytes(value.phoneNonce),
    phoneTag: copyBytes(value.phoneTag),
    firstSeenAt: new Date(value.firstSeenAt),
    lastSeenAt: new Date(value.lastSeenAt),
    expiresAt: new Date(value.expiresAt),
  };
}

function copyLink(value: ChannelLink): ChannelLink {
  return {
    ...value,
    reopenKeyCiphertext: copyBytes(value.reopenKeyCiphertext),
    reopenKeyNonce: copyBytes(value.reopenKeyNonce),
    reopenKeyTag: copyBytes(value.reopenKeyTag),
    lastMessageAt: new Date(value.lastMessageAt),
    closedAt: value.closedAt ? new Date(value.closedAt) : null,
    expiresAt: new Date(value.expiresAt),
  };
}
function copyCall(value: ChannelCall): ChannelCall {
  return {
    ...value,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    expiresAt: new Date(value.expiresAt),
  };
}

function copyInbox(value: ChannelInbox): ChannelInbox {
  return {
    ...value,
    bodyCiphertext: copyOptionalBytes(value.bodyCiphertext),
    bodyNonce: copyOptionalBytes(value.bodyNonce),
    bodyTag: copyOptionalBytes(value.bodyTag),
    nextAttemptAt: new Date(value.nextAttemptAt),
    createdAt: new Date(value.createdAt),
    expiresAt: new Date(value.expiresAt),
  };
}

function copyOutbox(value: ChannelOutbox): ChannelOutbox {
  return {
    ...value,
    bodyCiphertext: copyBytes(value.bodyCiphertext),
    bodyNonce: copyBytes(value.bodyNonce),
    bodyTag: copyBytes(value.bodyTag),
    nextAttemptAt: new Date(value.nextAttemptAt),
    sentAt: value.sentAt ? new Date(value.sentAt) : null,
    createdAt: new Date(value.createdAt),
    expiresAt: new Date(value.expiresAt),
  };
}

function copyRecording(value: ChannelRecording): ChannelRecording {
  return {
    ...value,
    bytes: copyOptionalBytes(value.bytes),
    createdAt: new Date(value.createdAt),
    expiresAt: new Date(value.expiresAt),
  };
}

export class MemoryChannelStore implements ChannelStore {
  readonly #identities = new Map<string, ChannelIdentity>();
  readonly #links = new Map<string, ChannelLink>();
  readonly #calls = new Map<string, ChannelCall>();
  readonly #decryptions = new Map<string, ChannelDecryption>();
  readonly #events = new Map<string, ChannelEvent>();
  readonly #inbox = new Map<string, ChannelInbox>();
  readonly #outbox = new Map<string, ChannelOutbox>();
  readonly #recordings = new Map<string, ChannelRecording>();
  readonly #rates = new Map<string, number>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsertIdentity(value: ChannelIdentity): Promise<void> {
    const existing = this.#identities.get(value.phoneHash);
    this.#identities.set(
      value.phoneHash,
      copyIdentity(
        existing
          ? {
              ...value,
              firstSeenAt:
                existing.firstSeenAt < value.firstSeenAt ? existing.firstSeenAt : value.firstSeenAt,
              lastSeenAt:
                existing.lastSeenAt > value.lastSeenAt ? existing.lastSeenAt : value.lastSeenAt,
              expiresAt:
                existing.expiresAt > value.expiresAt ? existing.expiresAt : value.expiresAt,
              blocked: existing.blocked || value.blocked,
            }
          : value,
      ),
    );
  }

  async getIdentity(phoneHash: string): Promise<ChannelIdentity | null> {
    const value = this.#identities.get(phoneHash);
    return value ? copyIdentity(value) : null;
  }

  async setBlocked(phoneHash: string, blocked: boolean): Promise<void> {
    const value = this.#identities.get(phoneHash);
    if (value) value.blocked = blocked;
  }

  async listOpenLinks(phoneHash: string): Promise<ChannelLink[]> {
    return [...this.#links.values()]
      .filter((value) => value.phoneHash === phoneHash && value.state === 'open')
      .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())
      .map(copyLink);
  }

  async findLinkByRecord(recordId: string): Promise<ChannelLink | null> {
    const found = [...this.#links.values()].find((value) => value.recordId === recordId);
    return found ? copyLink(found) : null;
  }

  async findLinkByCase(caseNumber: string): Promise<ChannelLink | null> {
    const found = [...this.#links.values()].find((value) => value.caseNumber === caseNumber);
    return found ? copyLink(found) : null;
  }

  async upsertLink(value: ChannelLink): Promise<void> {
    this.#links.set(`${value.phoneHash}\0${value.recordId}`, copyLink(value));
  }

  async closeLink(phoneHash: string, recordId: string, closure: LinkClosure): Promise<void> {
    const value = this.#links.get(`${phoneHash}\0${recordId}`);
    if (!value) return;
    value.state = 'closed';
    value.closedAt = new Date(closure.closedAt);
    value.expiresAt = new Date(
      Math.min(value.expiresAt.getTime(), new Date(closure.expiresAt).getTime()),
    );
  }

  async listLinksByState(state: ChannelLink['state'], limit: number): Promise<ChannelLink[]> {
    return [...this.#links.values()]
      .filter((value) => value.state === state)
      .sort((left, right) => left.lastMessageAt.getTime() - right.lastMessageAt.getTime())
      .slice(0, Math.max(0, limit))
      .map(copyLink);
  }

  async capIdentityExpiry(phoneHash: string, expiresAt: Date): Promise<void> {
    const value = this.#identities.get(phoneHash);
    if (value && value.expiresAt > expiresAt) value.expiresAt = new Date(expiresAt);
  }
  async upsertCall(value: ChannelCall): Promise<void> {
    const existing = this.#calls.get(value.callId);
    this.#calls.set(
      value.callId,
      copyCall(existing ? { ...value, createdAt: existing.createdAt } : value),
    );
  }

  async getCall(callId: string): Promise<ChannelCall | null> {
    const value = this.#calls.get(callId);
    return value ? copyCall(value) : null;
  }

  async markCallStep(callId: string, step: CallStep, updatedAt: Date): Promise<void> {
    const value = this.#calls.get(callId);
    if (!value) return;
    value.step = step;
    value.updatedAt = new Date(updatedAt);
  }

  async recordDecryption(value: ChannelDecryption): Promise<void> {
    this.#decryptions.set(value.id, { ...value, createdAt: new Date(value.createdAt) });
  }

  async recordEvent(
    provider: string,
    eventId: string,
    eventType: string,
    payloadSha256: string,
  ): Promise<{ duplicate: boolean }> {
    const key = `${provider}\0${eventId}`;
    if (this.#events.has(key)) return { duplicate: true };
    const now = this.now();
    this.#events.set(key, {
      provider,
      eventId,
      eventType,
      payloadSha256,
      state: 'received',
      attempts: 0,
      lastError: null,
      receivedAt: now,
      expiresAt: new Date(now.getTime() + 168 * 60 * 60 * 1_000),
    });
    return { duplicate: false };
  }

  async markEvent(
    provider: string,
    eventId: string,
    state: EventState,
    lastError: string | null = null,
  ): Promise<void> {
    const value = this.#events.get(`${provider}\0${eventId}`);
    if (value) {
      value.state = state;
      value.lastError = lastError;
      value.attempts += 1;
    }
  }

  async enqueueInbox(value: ChannelInbox): Promise<void> {
    if (
      value.providerEventId &&
      [...this.#inbox.values()].some((item) => item.providerEventId === value.providerEventId)
    ) {
      return;
    }
    this.#inbox.set(value.id, copyInbox(value));
  }

  async claimInbox(now: Date, limit: number): Promise<ChannelInbox[]> {
    const claimed = [...this.#inbox.values()]
      .filter(
        (value) =>
          (value.state === 'pending' || value.state === 'failed') && value.nextAttemptAt <= now,
      )
      .sort((left, right) =>
        left.nextAttemptAt.getTime() === right.nextAttemptAt.getTime()
          ? left.id.localeCompare(right.id)
          : left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime(),
      )
      .slice(0, Math.max(0, limit));
    for (const value of claimed) {
      value.state = 'processing';
      value.attempts += 1;
      value.lastError = null;
    }
    return claimed.map(copyInbox);
  }

  async completeInbox(id: string, completion: InboxCompletion = {}): Promise<void> {
    const value = this.#inbox.get(id);
    if (!value) return;
    value.state = 'done';
    value.lastError = null;
    value.bodyCiphertext = null;
    value.bodyNonce = null;
    value.bodyTag = null;
    value.keyVersion = null;
    if (completion.recordId !== undefined) value.recordId = completion.recordId;
    if (completion.caseNumber !== undefined) value.caseNumber = completion.caseNumber;
  }

  async failInbox(id: string, lastError: string, nextAttemptAt: Date): Promise<void> {
    const value = this.#inbox.get(id);
    if (!value) return;
    value.state = 'failed';
    value.lastError = lastError;
    value.nextAttemptAt = new Date(nextAttemptAt);
  }

  async enqueueOutbox(value: ChannelOutbox): Promise<void> {
    if (
      value.sourceMessageId &&
      [...this.#outbox.values()].some((item) => item.sourceMessageId === value.sourceMessageId)
    ) {
      return;
    }
    this.#outbox.set(value.id, copyOutbox(value));
  }

  async claimOutbox(now: Date, limit: number): Promise<ChannelOutbox[]> {
    const claimed = [...this.#outbox.values()]
      .filter((value) => value.state === 'pending' && value.nextAttemptAt <= now)
      .sort((left, right) =>
        left.nextAttemptAt.getTime() === right.nextAttemptAt.getTime()
          ? left.id.localeCompare(right.id)
          : left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime(),
      )
      .slice(0, Math.max(0, limit));
    for (const value of claimed) {
      value.attempts += 1;
      value.nextAttemptAt = new Date(now.getTime() + 60_000);
      value.lastError = null;
    }
    return claimed.map(copyOutbox);
  }

  async markOutboxSent(id: string, providerMessageId: string, sentAt: Date): Promise<void> {
    const value = this.#outbox.get(id);
    if (!value) return;
    value.state = 'sent';
    value.providerMessageId = providerMessageId;
    value.sentAt = new Date(sentAt);
    value.lastError = null;
  }

  async markOutboxFailed(id: string, lastError: string): Promise<void> {
    const value = this.#outbox.get(id);
    if (!value) return;
    value.state = 'failed';
    value.lastError = lastError;
  }

  async markOutboxDelivery(
    providerMessageId: string,
    state: Extract<OutboxState, 'delivered' | 'failed'>,
    failureCode?: string,
  ): Promise<void> {
    for (const value of this.#outbox.values()) {
      if (value.providerMessageId !== providerMessageId) continue;
      value.state = state;
      value.lastError = failureCode ?? null;
    }
  }

  async findOutboxBySource(sourceMessageId: string): Promise<ChannelOutbox | null> {
    const value = [...this.#outbox.values()].find(
      (candidate) => candidate.sourceMessageId === sourceMessageId,
    );
    return value ? copyOutbox(value) : null;
  }

  async putRecording(value: ChannelRecording): Promise<void> {
    if (value.providerRecordingId) {
      const duplicate = [...this.#recordings.entries()].find(
        ([, item]) => item.providerRecordingId === value.providerRecordingId,
      );
      if (duplicate && duplicate[0] !== value.id) this.#recordings.delete(duplicate[0]);
    }
    this.#recordings.set(value.id, copyRecording(value));
  }

  async getRecording(id: string): Promise<ChannelRecording | null> {
    const value = this.#recordings.get(id);
    return value ? copyRecording(value) : null;
  }

  async updateRecording(id: string, update: RecordingUpdate): Promise<void> {
    const value = this.#recordings.get(id);
    if (!value) return;
    if (update.state !== undefined) value.state = update.state;
    if (update.distortedSha256 !== undefined) value.distortedSha256 = update.distortedSha256;
    if (update.bytes !== undefined) value.bytes = copyOptionalBytes(update.bytes);
    if (update.expiresAt !== undefined) value.expiresAt = new Date(update.expiresAt);
  }

  async bumpRate(scope: string, key: string, windowStart: Date): Promise<number> {
    const rateKey = `${scope}\0${key}\0${windowStart.toISOString()}`;
    const count = (this.#rates.get(rateKey) ?? 0) + 1;
    this.#rates.set(rateKey, count);
    return count;
  }

  async purgeExpired(now: Date): Promise<PurgeCounts> {
    const counts: PurgeCounts = {
      events: 0,
      inbox: 0,
      outbox: 0,
      recordings: 0,
      calls: 0,
      links: 0,
      identities: 0,
    };
    for (const [key, value] of this.#events) {
      if (value.expiresAt <= now) {
        this.#events.delete(key);
        counts.events += 1;
      }
    }
    for (const [key, value] of this.#inbox) {
      if (value.expiresAt <= now) {
        this.#inbox.delete(key);
        counts.inbox += 1;
        for (const recording of this.#recordings.values()) {
          if (recording.inboxId === key) recording.inboxId = null;
        }
      }
    }
    for (const [key, value] of this.#outbox) {
      if (value.expiresAt <= now) {
        this.#outbox.delete(key);
        counts.outbox += 1;
      }
    }
    for (const [key, value] of this.#recordings) {
      if (value.expiresAt <= now) {
        this.#recordings.delete(key);
        counts.recordings += 1;
      }
    }
    for (const [key, value] of this.#calls) {
      if (value.expiresAt <= now) {
        this.#calls.delete(key);
        counts.calls += 1;
      }
    }
    for (const [key, value] of this.#links) {
      if (value.expiresAt <= now) {
        this.#links.delete(key);
        counts.links += 1;
      }
    }
    const linked = new Set([...this.#links.values()].map((value) => value.phoneHash));
    for (const [key, value] of this.#identities) {
      if (value.expiresAt <= now && !linked.has(value.phoneHash)) {
        this.#identities.delete(key);
        counts.identities += 1;
      }
    }
    return counts;
  }

  async ping(): Promise<void> {}
}

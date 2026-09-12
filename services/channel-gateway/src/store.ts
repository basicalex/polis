// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ChannelEvent,
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

export interface ChannelStore {
  upsertIdentity(identity: ChannelIdentity): Promise<void>;
  getIdentity(phoneHash: string): Promise<ChannelIdentity | null>;
  setBlocked(phoneHash: string, blocked: boolean): Promise<void>;
  listOpenLinks(phoneHash: string): Promise<ChannelLink[]>;
  findLinkByRecord(recordId: string): Promise<ChannelLink | null>;
  upsertLink(link: ChannelLink): Promise<void>;
  closeLink(phoneHash: string, recordId: string): Promise<void>;
  recordEvent(
    provider: string,
    eventId: string,
    eventType: string,
    payloadSha256: string,
  ): Promise<{ duplicate: boolean }>;
  markEvent(
    provider: string,
    eventId: string,
    state: EventState,
    lastError?: string | null,
  ): Promise<void>;
  enqueueInbox(item: ChannelInbox): Promise<void>;
  claimInbox(now: Date, limit: number): Promise<ChannelInbox[]>;
  completeInbox(id: string, completion?: InboxCompletion): Promise<void>;
  failInbox(id: string, lastError: string, nextAttemptAt: Date): Promise<void>;
  enqueueOutbox(item: ChannelOutbox): Promise<void>;
  claimOutbox(now: Date, limit: number): Promise<ChannelOutbox[]>;
  markOutboxSent(id: string, providerMessageId: string, sentAt: Date): Promise<void>;
  /** Terminal: the row is never claimed again. */
  markOutboxFailed(id: string, lastError: string): Promise<void>;
  markOutboxDelivery(providerMessageId: string, state: Extract<OutboxState, 'delivered' | 'failed'>): Promise<void>;
  findOutboxBySource(sourceMessageId: string): Promise<ChannelOutbox | null>;
  putRecording(recording: ChannelRecording): Promise<void>;
  getRecording(id: string): Promise<ChannelRecording | null>;
  updateRecording(id: string, update: RecordingUpdate): Promise<void>;
  bumpRate(scope: string, key: string, windowStart: Date): Promise<number>;
  purgeExpired(now: Date): Promise<PurgeCounts>;
  ping(): Promise<void>;
}

export type { ChannelEvent };

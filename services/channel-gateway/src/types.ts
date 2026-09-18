// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export type ChannelKind = 'sms' | 'voice';
export type EventState = 'received' | 'processed' | 'failed';
export type InboxKind = 'sms_inbound' | 'voice_recording' | 'voice_call';
export type InboxState = 'pending' | 'processing' | 'done' | 'failed';
export type OutboxOrigin = 'relay' | 'confirmation' | 'system';
export type OutboxState = 'pending' | 'sent' | 'delivered' | 'failed';
export type RecordingState = 'fetched' | 'distorted' | 'transcribed' | 'discarded' | 'failed';
export type CallStep = 'answered' | 'prompt' | 'readback' | 'recording' | 'done';

export interface ChannelIdentity {
  phoneHash: string;
  phoneCiphertext: Uint8Array;
  phoneNonce: Uint8Array;
  phoneTag: Uint8Array;
  keyVersion: number;
  municipalityId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  blocked: boolean;
}

export interface ChannelLink {
  phoneHash: string;
  recordId: string;
  caseNumber: string;
  reopenKeyCiphertext: Uint8Array;
  reopenKeyNonce: Uint8Array;
  reopenKeyTag: Uint8Array;
  keyVersion: number;
  channel: ChannelKind;
  state: 'open' | 'closed';
  lastMessageAt: Date;
  /** When the case reached a terminal state (resolved or closed); null while the link is open. */
  closedAt: Date | null;
  expiresAt: Date;
}

export type DecryptionReason = 'outbound-sms' | 'reveal';

export interface ChannelDecryption {
  id: string;
  phoneHashPrefix: string;
  reason: DecryptionReason;
  caseNumber: string | null;
  requestRef: string | null;
  actor: string;
  createdAt: Date;
}

export interface LinkClosure {
  closedAt: Date;
  expiresAt: Date;
}

export interface ChannelEvent {
  provider: string;
  eventId: string;
  eventType: string;
  payloadSha256: string;
  state: EventState;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  expiresAt: Date;
}

export interface ChannelCall {
  callId: string;
  phoneHash: string;
  caseNumber: string | null;
  recordId: string | null;
  step: CallStep;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface ChannelInbox {
  id: string;
  providerEventId: string | null;
  kind: InboxKind;
  phoneHash: string;
  bodyCiphertext: Uint8Array | null;
  bodyNonce: Uint8Array | null;
  bodyTag: Uint8Array | null;
  keyVersion: number | null;
  providerRef: string | null;
  callControlId: string | null;
  state: InboxState;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  recordId: string | null;
  caseNumber: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface InboxCompletion {
  recordId?: string | null;
  caseNumber?: string | null;
}

export interface ChannelOutbox {
  id: string;
  sourceMessageId: string | null;
  recordId: string;
  caseNumber: string;
  phoneHash: string;
  bodyCiphertext: Uint8Array;
  bodyNonce: Uint8Array;
  bodyTag: Uint8Array;
  keyVersion: number;
  origin: OutboxOrigin;
  state: OutboxState;
  providerMessageId: string | null;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface ChannelRecording {
  id: string;
  providerRecordingId: string | null;
  inboxId: string | null;
  state: RecordingState;
  distortedSha256: string | null;
  bytes: Uint8Array | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface RecordingUpdate {
  state?: RecordingState;
  distortedSha256?: string | null;
  bytes?: Uint8Array | null;
  expiresAt?: Date;
}

export interface PurgeCounts {
  events: number;
  inbox: number;
  outbox: number;
  recordings: number;
  calls: number;
  links: number;
  identities: number;
}

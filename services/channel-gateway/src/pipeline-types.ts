// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared contract between the SMS pipeline (pipeline.ts, relay.ts, routes.ts) and the voice
// pipeline (voice.ts, audio/*, stt-provider.ts). Types only: no runtime code lives here.

import type { ChannelConfig } from './config.js';
import type { LogFields } from './log.js';
import type { ChannelStore } from './store.js';
import type { ChannelInbox, ChannelKind } from './types.js';

/** Parsed Telnyx webhook envelope (`data` of the raw body). */
export interface TelnyxEvent {
  /** `data.id`; used as the dedupe key in channel_events. */
  id: string;
  /** `data.event_type`, e.g. `message.received`, `call.answered`. */
  eventType: string;
  /** `data.occurred_at` (ISO string) when present. */
  occurredAt: string | null;
  /** `data.payload`, untyped. Handlers narrow what they need. */
  payload: Record<string, unknown>;
  /** sha256 hex of the raw request body. */
  payloadSha256: string;
}

export type InboxRow = ChannelInbox;

export interface SendSmsInput {
  to: string;
  text: string;
  idempotencyKey: string;
}

export interface SpeakInput {
  text: string;
  voice: string;
  language: string;
  clientState?: string;
}

export interface RecordStartInput {
  format: 'wav';
  channels: 'single';
  maxLengthSeconds: number;
  timeoutSeconds: number;
  trim: 'trim-silence';
  playBeep: boolean;
  commandId: string;
  clientState?: string;
}

export interface ChannelProvider {
  readonly name: 'stub' | 'telnyx';
  sendSms(input: SendSmsInput): Promise<{ providerMessageId: string }>;
  answerCall(callControlId: string, clientState: string): Promise<void>;
  speak(callControlId: string, input: SpeakInput): Promise<void>;
  recordStart(callControlId: string, input: RecordStartInput): Promise<void>;
  hangup(callControlId: string): Promise<void>;
  fetchRecording(url: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array>;
  deleteRecording(recordingId: string): Promise<void>;
}

export interface SttProvider {
  readonly name: 'stub' | 'openai-compatible';
  transcribe(input: {
    audio: Uint8Array;
    mimeType: 'audio/wav';
    languageHint: 'hr';
  }): Promise<{ text: string; durationSeconds: number | null }>;
}

/** Wire shapes of trace-service `/internal/trace/channel/*` as seen by the gateway. */
export interface TraceChannelCase {
  recordId: string;
  caseNumber: string;
  reopenKey: string;
  state: string;
}

export interface TraceOutboxMessage {
  id: string;
  recordId: string;
  kind: string;
  body: string;
  createdAt: string;
}

export interface TraceClient {
  createChannelCase(
    input: {
      channel: ChannelKind;
      text: string | null;
      location?: string;
      source: 'typed' | 'transcript' | 'system';
      occurredAt: string;
    },
    idempotencyKey: string,
  ): Promise<{ case: TraceChannelCase }>;
  appendChannelMessage(
    caseNumber: string,
    input: {
      reopenKey: string;
      channel: ChannelKind;
      kind: 'append' | 'transcript' | 'transcript-failed';
      text: string | null;
      source: 'typed' | 'transcript' | 'system';
      occurredAt: string;
    },
    idempotencyKey: string,
  ): Promise<{ message: { id: string } }>;
  listOutbox(limit: number): Promise<{ messages: TraceOutboxMessage[] }>;
  markDelivery(
    messageId: string,
    input: { state: 'handed-off' | 'delivered' | 'failed'; failureCode?: string },
    idempotencyKey: string,
  ): Promise<void>;
}

export interface AuditClient {
  emit(event: {
    eventType: string;
    code: string;
    channel?: ChannelKind;
    eventId?: string;
    phoneHashPrefix?: string;
    caseNumber?: string;
    recordId?: string;
  }): Promise<void>;
}

export interface PipelineDeps {
  config: ChannelConfig;
  store: ChannelStore;
  provider: ChannelProvider;
  trace: TraceClient;
  audit: AuditClient;
  log: (fields: LogFields) => void;
  now: () => Date;
  stt?: SttProvider;
}

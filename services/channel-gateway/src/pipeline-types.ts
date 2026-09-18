// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

// Shared contract between the SMS pipeline (pipeline.ts, relay.ts, routes.ts) and the voice
// pipeline (voice.ts, audio/*, stt-provider.ts). Types only: no runtime code lives here.

import type { ChannelConfig } from './config.js';
import type { LogFields } from './log.js';
import type { ChannelStore } from './store.js';
import type { ChannelInbox, ChannelKind, DecryptionReason } from './types.js';

/** Parsed provider webhook event; one source result maps to one dedupe record. */
export interface ProviderEvent {
  id: string;
  eventType: string;
  occurredAt: string | null;
  payload: Record<string, unknown>;
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
  language: string;
  voice?: string;
}

export interface RecordStartInput {
  maxLengthSeconds: number;
  transcription: boolean;
}

export interface ChannelProvider {
  readonly name: 'stub' | 'infobip';
  sendSms(input: SendSmsInput): Promise<{ providerMessageId: string }>;
  answerCall(callId: string): Promise<void>;
  speak(callId: string, input: SpeakInput): Promise<void>;
  recordStart(callId: string, input: RecordStartInput): Promise<void>;
  hangup(callId: string): Promise<void>;
  listRecordings(
    callId: string,
  ): Promise<Array<{ fileId: string; durationSeconds: number | null }>>;
  fetchRecording(fileId: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array>;
  deleteRecording(fileId: string): Promise<void>;
}

export interface SttProvider {
  readonly name: 'stub' | 'openai-compatible' | 'infobip';
  transcribe(input: {
    audio: Uint8Array;
    mimeType: 'audio/wav';
    languageHint: 'hr';
    providerFileId?: string;
  }): Promise<{ text: string; durationSeconds: number | null }>;
}

/** Wire shapes of trace-service `/internal/trace/channel/*` as seen by the gateway. */
export interface TraceChannelCase {
  recordId: string;
  caseNumber: string;
  reopenKey: string;
  state: string;
}

export interface TraceCaseClosure {
  state: string;
  terminalAt: string | null;
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
  /** Returns null when trace does not know the case. */
  readCaseClosure(caseNumber: string): Promise<TraceCaseClosure | null>;
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
    reason?: DecryptionReason;
    requestRef?: string;
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

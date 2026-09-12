// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { distortRecording } from './audio/distort.js';
import { PROMPT_HR, SMS_CONFIRM, spellCaseNumberHr } from './copy-hr.js';
import { openString, phoneHash, sealString } from './crypto.js';
import { phoneHashPrefix } from './log.js';
import { normalizeE164 } from './phone.js';
import type { InboxRow, PipelineDeps, TelnyxEvent } from './pipeline-types.js';
import type { ChannelInbox } from './types.js';

const TELNYX_VOICE_LANGUAGE = 'hr-HR';
const DEFAULT_TELNYX_TTS_VOICE = 'Azure.hr-HR-GabrijelaNeural';
const RECORDING_DOWNLOAD_TIMEOUT_MS = 30_000;
const RECORDING_MAX_BYTES_PER_SECOND = 32_000;
const TRANSCRIPT_FAILED_TEXT = 'Transkripcija glasovne prijave nije uspjela.';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function jsonState(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function parseJsonState(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  return stringField(payload[key]);
}

function callControlId(event: TelnyxEvent): string | null {
  return payloadString(event.payload, 'call_control_id');
}

function eventTime(event: TelnyxEvent, deps: PipelineDeps): string {
  return event.occurredAt ?? deps.now().toISOString();
}

function activeVaultKey(deps: PipelineDeps): Uint8Array {
  const key = deps.config.vaultKeys.get(deps.config.activeVaultKeyVersion);
  if (!key) throw new Error('active vault key is missing');
  return key;
}

function ttl(deps: PipelineDeps): Date {
  return addDays(deps.now(), deps.config.vaultTtlDays);
}

function phoneIdentityHash(e164: string, deps: PipelineDeps): string {
  return phoneHash(e164, deps.config.vaultPepper, deps.config.municipalityId);
}

function seal(deps: PipelineDeps, plaintext: string, aad: 'phone' | 'reopen-key' | 'outbox-body') {
  return sealString(activeVaultKey(deps), plaintext, aad);
}

function speakInput(text: string, clientState: Record<string, unknown>, deps: PipelineDeps) {
  return {
    text,
    voice: deps.config.telnyx?.ttsVoice ?? DEFAULT_TELNYX_TTS_VOICE,
    language: TELNYX_VOICE_LANGUAGE,
    clientState: jsonState(clientState),
  };
}

function voiceCallInboxId(callControlId: string): string {
  return `voice-call:${callControlId}`;
}

function recordingUrl(payload: Record<string, unknown>): string | null {
  const urls = payload.recording_urls;
  if (urls && typeof urls === 'object' && !Array.isArray(urls)) return stringField((urls as Record<string, unknown>).wav);
  return payloadString(payload, 'recording_url');
}

function makeInbox(input: {
  id?: string;
  eventId: string | null;
  kind: ChannelInbox['kind'];
  phoneHash: string;
  providerRef: string | null;
  callControlId: string | null;
  recordId: string | null;
  caseNumber: string | null;
  state?: ChannelInbox['state'];
  deps: PipelineDeps;
}): ChannelInbox {
  const now = input.deps.now();
  return {
    id: input.id ?? randomUUID(),
    providerEventId: input.eventId,
    kind: input.kind,
    phoneHash: input.phoneHash,
    bodyCiphertext: null,
    bodyNonce: null,
    bodyTag: null,
    keyVersion: null,
    providerRef: input.providerRef,
    callControlId: input.callControlId,
    state: input.state ?? 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    recordId: input.recordId,
    caseNumber: input.caseNumber,
    createdAt: now,
    expiresAt: addHours(now, input.deps.config.eventTtlHours),
  };
}

async function handleAnswered(event: TelnyxEvent, deps: PipelineDeps): Promise<void> {
  const id = callControlId(event);
  const rawFrom = payloadString(event.payload, 'from');
  if (!id || !rawFrom) return;

  const e164 = normalizeE164(rawFrom);
  const hash = phoneIdentityHash(e164, deps);
  const now = deps.now();
  const existing = await deps.store.getIdentity(hash);
  if (existing?.blocked) {
    await deps.provider.hangup(id);
    return;
  }

  const phone = seal(deps, e164, 'phone');
  await deps.store.upsertIdentity({
    phoneHash: hash,
    phoneCiphertext: phone.ciphertext,
    phoneNonce: phone.nonce,
    phoneTag: phone.tag,
    keyVersion: deps.config.activeVaultKeyVersion,
    municipalityId: deps.config.municipalityId,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    expiresAt: ttl(deps),
    blocked: false,
  });

  const created = await deps.trace.createChannelCase(
    { channel: 'voice', text: null, source: 'system', occurredAt: eventTime(event, deps) },
    id,
  );
  const reopen = seal(deps, created.case.reopenKey, 'reopen-key');
  await deps.store.upsertLink({
    phoneHash: hash,
    recordId: created.case.recordId,
    caseNumber: created.case.caseNumber,
    reopenKeyCiphertext: reopen.ciphertext,
    reopenKeyNonce: reopen.nonce,
    reopenKeyTag: reopen.tag,
    keyVersion: deps.config.activeVaultKeyVersion,
    channel: 'voice',
    state: 'open',
    lastMessageAt: now,
    expiresAt: ttl(deps),
  });
  await deps.store.enqueueInbox(
    makeInbox({
      id: voiceCallInboxId(id),
      eventId: event.id,
      kind: 'voice_call',
      phoneHash: hash,
      providerRef: id,
      callControlId: id,
      recordId: created.case.recordId,
      caseNumber: created.case.caseNumber,
      state: 'done',
      deps,
    }),
  );
  const readback = `Broj predmeta: ${created.case.caseNumber}. Slovkano: ${spellCaseNumberHr(created.case.caseNumber)}.`;
  await deps.provider.speak(id, speakInput(`${PROMPT_HR}\n\n${readback}`, { v: 1, eventId: event.id, step: 'prompt', caseNumber: created.case.caseNumber, recordId: created.case.recordId }, deps));
}

async function handleSpeakEnded(event: TelnyxEvent, deps: PipelineDeps): Promise<void> {
  const id = callControlId(event);
  if (!id) return;
  const state = parseJsonState(event.payload.client_state);
  if (state.step !== 'prompt' || typeof state.caseNumber !== 'string' || typeof state.recordId !== 'string') return;
  const caseNumber = state.caseNumber;
  const recordId = state.recordId;
  // The prompt already includes the readback; after Telnyx reports it ended, start recording.
  await deps.provider.recordStart(id, {
    format: 'wav',
    channels: 'single',
    maxLengthSeconds: deps.config.maxRecordingSeconds,
    timeoutSeconds: 5,
    trim: 'trim-silence',
    playBeep: true,
    commandId: `voice-record-${caseNumber}`,
    clientState: jsonState({ v: 1, eventId: event.id, step: 'recording', caseNumber, recordId }),
  });
}

async function handleRecordingEvent(event: TelnyxEvent, deps: PipelineDeps): Promise<void> {
  const id = callControlId(event);
  if (!id) return;
  if (event.eventType === 'call.recording.error') {
    const state = parseJsonState(event.payload.client_state);
    if (typeof state.caseNumber === 'string' && typeof state.recordId === 'string') {
      await deps.store.failInbox(voiceCallInboxId(id), 'recording error', deps.now());
      await deps.audit.emit({ eventType: 'channel.voice.recording_error', code: 'recording_error', channel: 'voice', eventId: event.id, caseNumber: state.caseNumber, recordId: state.recordId });
    }
    await deps.provider.hangup(id);
    return;
  }
  const url = recordingUrl(event.payload);
  const providerRecordingId = payloadString(event.payload, 'recording_id');
  const state = parseJsonState(event.payload.client_state);
  const caseNumber = typeof state.caseNumber === 'string' ? state.caseNumber : null;
  const recordId = typeof state.recordId === 'string' ? state.recordId : null;
  if (!url || !caseNumber || !recordId) {
    await deps.provider.hangup(id);
    return;
  }
  const link = await deps.store.findLinkByRecord(recordId);
  const phoneHash = link?.phoneHash ?? '0'.repeat(64);
  const inbox = makeInbox({
    eventId: event.id,
    kind: 'voice_recording',
    phoneHash,
    providerRef: url,
    callControlId: id,
    recordId,
    caseNumber,
    deps,
  });
  await deps.store.enqueueInbox(inbox);
  await deps.store.putRecording({
    id: inbox.id,
    providerRecordingId,
    inboxId: inbox.id,
    state: 'fetched',
    distortedSha256: null,
    bytes: null,
    createdAt: deps.now(),
    expiresAt: addMinutes(deps.now(), deps.config.audioTtlMinutes),
  });
  await deps.provider.hangup(id);
}

export async function handleVoiceEvent(event: TelnyxEvent, deps: PipelineDeps): Promise<void> {
  if (event.eventType === 'call.initiated' && event.payload.direction === 'incoming') {
    const id = callControlId(event);
    if (id) await deps.provider.answerCall(id, jsonState({ v: 1, eventId: event.id }));
  } else if (event.eventType === 'call.answered') {
    await handleAnswered(event, deps);
  } else if (event.eventType === 'call.speak.ended') {
    await handleSpeakEnded(event, deps);
  } else if (event.eventType === 'call.recording.saved' || event.eventType === 'call.recording.error') {
    await handleRecordingEvent(event, deps);
  } else if (event.eventType === 'call.hangup') {
    // Telnyx hangup is terminal state notification; no command needed.
  }
}

async function reopenKeyForRecord(recordId: string, deps: PipelineDeps): Promise<string> {
  const link = await deps.store.findLinkByRecord(recordId);
  if (!link) throw new Error('voice link is missing');
  const key = deps.config.vaultKeys.get(link.keyVersion);
  if (!key) throw new Error('voice link key is missing');
  return openString(
    key,
    { ciphertext: Buffer.from(link.reopenKeyCiphertext), nonce: Buffer.from(link.reopenKeyNonce), tag: Buffer.from(link.reopenKeyTag) },
    'reopen-key',
  );
}

export async function handleRecordingSaved(row: InboxRow, deps: PipelineDeps): Promise<void> {
  if (row.kind !== 'voice_recording' || !row.providerRef || !row.callControlId || !row.caseNumber || !row.recordId) return;

  const maxBytes = deps.config.stt?.maxBytes ?? Math.max(1024, deps.config.maxRecordingSeconds * RECORDING_MAX_BYTES_PER_SECOND);
  const recording = await deps.store.getRecording(row.id);
  const recordingId = recording?.providerRecordingId;
  let original: Uint8Array | null = null;
  let reopenKey = '';
  try {
    try {
      original = await deps.provider.fetchRecording(row.providerRef, maxBytes, RECORDING_DOWNLOAD_TIMEOUT_MS);
    } finally {
      if (recordingId) await deps.provider.deleteRecording(recordingId);
    }
    reopenKey = await reopenKeyForRecord(row.recordId, deps);
    if (!original) throw new Error('recording download returned no bytes');
    const seed = recordingId ?? row.id;
    const distorted = distortRecording(original, { semitones: deps.config.distortSemitones, seed });
    original.fill(0);
    await deps.store.updateRecording(row.id, {
      state: 'distorted',
      distortedSha256: distorted.sha256,
      bytes: deps.config.audioSink === 'gateway' ? distorted.bytes : null,
      expiresAt: addMinutes(deps.now(), deps.config.audioTtlMinutes),
    });

    const transcript = await deps.stt?.transcribe({ audio: distorted.bytes, mimeType: 'audio/wav', languageHint: 'hr' });
    if (!transcript) throw new Error('STT provider is not configured');
    await deps.trace.appendChannelMessage(
      row.caseNumber,
      { reopenKey, channel: 'voice', kind: 'transcript', text: transcript.text, source: 'transcript', occurredAt: deps.now().toISOString() },
      row.id,
    );
    if (deps.config.audioSink === 'gateway') {
      await deps.store.updateRecording(row.id, { state: 'transcribed' });
    } else {
      await deps.store.updateRecording(row.id, { state: 'discarded', bytes: null });
    }
    if (deps.config.audioSink === 'trace') {
      deps.log({ service: 'channel-gateway', stage: 'voice', code: 'sink_unsupported', phoneHashPrefix: phoneHashPrefix(row.phoneHash), recordId: row.recordId, caseNumber: row.caseNumber });
    }
    await deps.store.completeInbox(row.id, { recordId: row.recordId, caseNumber: row.caseNumber });

    const confirmation = seal(deps, SMS_CONFIRM(row.caseNumber), 'outbox-body');
    await deps.store.enqueueOutbox({
      id: randomUUID(),
      sourceMessageId: null,
      recordId: row.recordId,
      caseNumber: row.caseNumber,
      phoneHash: row.phoneHash,
      bodyCiphertext: confirmation.ciphertext,
      bodyNonce: confirmation.nonce,
      bodyTag: confirmation.tag,
      keyVersion: deps.config.activeVaultKeyVersion,
      origin: 'confirmation',
      state: 'pending',
      providerMessageId: null,
      attempts: 0,
      nextAttemptAt: deps.now(),
      lastError: null,
      sentAt: null,
      createdAt: deps.now(),
      expiresAt: ttl(deps),
    });
    deps.log({ service: 'channel-gateway', stage: 'voice', code: 'transcribed', phoneHashPrefix: phoneHashPrefix(row.phoneHash), recordId: row.recordId, caseNumber: row.caseNumber });
  } catch (cause) {
    if (original) original.fill(0);
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!reopenKey) {
      try {
        reopenKey = await reopenKeyForRecord(row.recordId, deps);
      } catch {
        // A missing link prevents trace notification, but local failure state still persists.
      }
    }
    if (reopenKey) {
      await deps.trace.appendChannelMessage(
        row.caseNumber,
        { reopenKey, channel: 'voice', kind: 'transcript-failed', text: TRANSCRIPT_FAILED_TEXT, source: 'system', occurredAt: deps.now().toISOString() },
        `${row.id}:failed`,
      );
    }
    await deps.store.updateRecording(row.id, { state: 'failed', bytes: null });
    await deps.store.failInbox(row.id, message, addMinutes(deps.now(), 5));
    deps.log({ service: 'channel-gateway', stage: 'voice', code: 'transcript_failed', phoneHashPrefix: phoneHashPrefix(row.phoneHash), recordId: row.recordId, caseNumber: row.caseNumber, error: message });
  }
}

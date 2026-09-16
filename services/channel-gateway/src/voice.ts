// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomUUID } from 'node:crypto';

import { distortRecording } from './audio/distort.js';
import { PROMPT_HR, SMS_CONFIRM, spellCaseNumberHr } from './copy-hr.js';
import { openString, phoneHash, sealString } from './crypto.js';
import { INFOBIP_EVENT_TYPES } from './infobip-api.js';
import { phoneHashPrefix } from './log.js';
import { normalizeE164 } from './phone.js';
import type { InboxRow, PipelineDeps, ProviderEvent } from './pipeline-types.js';
import type { ChannelCall, ChannelInbox } from './types.js';

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

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function callId(event: ProviderEvent): string | null {
  return stringField(event.payload.callId);
}

function eventTime(event: ProviderEvent, deps: PipelineDeps): string {
  return event.occurredAt ?? deps.now().toISOString();
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const field = value[key];
  return field && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null;
}

function callProperties(event: ProviderEvent): Record<string, unknown> | null {
  const properties = objectField(event.payload, 'properties');
  return properties ? objectField(properties, 'call') : null;
}

function activeVaultKey(deps: PipelineDeps): Uint8Array {
  const key = deps.config.vaultKeys.get(deps.config.activeVaultKeyVersion);
  if (!key) throw new Error('active vault key is missing');
  return key;
}

function ttl(deps: PipelineDeps): Date {
  return addDays(deps.now(), deps.config.vaultTtlDays);
}

function seal(deps: PipelineDeps, plaintext: string, aad: 'phone' | 'reopen-key' | 'outbox-body') {
  return sealString(activeVaultKey(deps), plaintext, aad);
}

function voiceCallInboxId(id: string): string {
  const hex = createHash('sha256').update(`voice-call:${id}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function recordingInboxId(fileId: string): string {
  const hex = createHash('sha256').update(`voice-recording:${fileId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function makeInbox(input: {
  id?: string;
  eventId: string | null;
  kind: ChannelInbox['kind'];
  phoneHash: string;
  providerRef: string | null;
  callId: string | null;
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
    callControlId: input.callId,
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

async function handleCallReceived(event: ProviderEvent, deps: PipelineDeps): Promise<void> {
  const id = callId(event);
  const call = callProperties(event);
  const rawFrom = stringField(call?.from);
  if (!id || !call || call.direction !== 'INBOUND' || !rawFrom) return;
  if (await deps.store.getCall(id)) return;
  let e164: string;
  try {
    e164 = normalizeE164(rawFrom);
  } catch {
    await deps.provider.hangup(id);
    return;
  }
  const hash = phoneHash(e164, deps.config.vaultPepper, deps.config.municipalityId);
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
  await deps.store.upsertCall({
    callId: id,
    phoneHash: hash,
    caseNumber: null,
    recordId: null,
    step: 'answered',
    createdAt: now,
    updatedAt: now,
    expiresAt: addHours(now, deps.config.eventTtlHours),
  });
  await deps.provider.answerCall(id);
}

async function handleCallEstablished(event: ProviderEvent, deps: PipelineDeps): Promise<void> {
  const id = callId(event);
  if (!id) return;
  const state = await deps.store.getCall(id);
  if (!state || state.caseNumber || state.recordId) return;
  const created = await deps.trace.createChannelCase(
    { channel: 'voice', text: null, source: 'system', occurredAt: eventTime(event, deps) },
    id,
  );
  const now = deps.now();
  const reopen = seal(deps, created.case.reopenKey, 'reopen-key');
  await deps.store.upsertLink({
    phoneHash: state.phoneHash,
    recordId: created.case.recordId,
    caseNumber: created.case.caseNumber,
    reopenKeyCiphertext: reopen.ciphertext,
    reopenKeyNonce: reopen.nonce,
    reopenKeyTag: reopen.tag,
    keyVersion: deps.config.activeVaultKeyVersion,
    channel: 'voice',
    state: 'open',
    closedAt: null,
    lastMessageAt: now,
    expiresAt: ttl(deps),
  });
  await deps.store.enqueueInbox(
    makeInbox({
      id: voiceCallInboxId(id),
      eventId: event.id,
      kind: 'voice_call',
      phoneHash: state.phoneHash,
      providerRef: id,
      callId: id,
      recordId: created.case.recordId,
      caseNumber: created.case.caseNumber,
      state: 'done',
      deps,
    }),
  );
  await deps.store.upsertCall({
    ...state,
    caseNumber: created.case.caseNumber,
    recordId: created.case.recordId,
    step: 'prompt',
    updatedAt: now,
  });
  const infobip = deps.config.infobip;
  await deps.provider.speak(id, {
    text: PROMPT_HR,
    language: infobip?.ttsLanguage ?? 'hr',
    ...(infobip?.ttsVoice ? { voice: infobip.ttsVoice } : {}),
  });
}

async function handleSayFinished(event: ProviderEvent, deps: PipelineDeps): Promise<void> {
  const id = callId(event);
  if (!id) return;
  const state = await deps.store.getCall(id);
  if (!state || !state.caseNumber || !state.recordId) return;
  if (state.step === 'prompt') {
    await deps.provider.recordStart(id, {
      maxLengthSeconds: deps.config.maxRecordingSeconds,
      transcription: deps.config.sttProvider === 'infobip',
    });
    await deps.store.markCallStep(id, 'readback', deps.now());
    const infobip = deps.config.infobip;
    await deps.provider.speak(id, {
      text: `Broj predmeta: ${state.caseNumber}. Slovkano: ${spellCaseNumberHr(state.caseNumber)}.`,
      language: infobip?.ttsLanguage ?? 'hr',
      ...(infobip?.ttsVoice ? { voice: infobip.ttsVoice } : {}),
    });
  } else if (state.step === 'readback') {
    await deps.store.markCallStep(id, 'recording', deps.now());
  }
}

function recordingFiles(
  event: ProviderEvent,
): Array<{ fileId: string; durationSeconds: number | null }> {
  const properties = objectField(event.payload, 'properties');
  const recording = properties ? objectField(properties, 'recording') : null;
  if (!recording || !Array.isArray(recording.files)) return [];
  const files: Array<{ fileId: string; durationSeconds: number | null }> = [];
  for (const entry of recording.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const file = entry as Record<string, unknown>;
    const fileId = stringField(file.fileId);
    if (!fileId) continue;
    const durationSeconds =
      typeof file.durationSeconds === 'number' && Number.isFinite(file.durationSeconds)
        ? file.durationSeconds
        : null;
    files.push({ fileId, durationSeconds });
  }
  return files;
}

async function enqueueRecording(
  state: ChannelCall,
  file: { fileId: string; durationSeconds: number | null },
  deps: PipelineDeps,
): Promise<void> {
  if (!state.caseNumber || !state.recordId) return;
  const inbox = makeInbox({
    id: recordingInboxId(file.fileId),
    eventId: `voice-recording:${file.fileId}`,
    kind: 'voice_recording',
    phoneHash: state.phoneHash,
    providerRef: file.fileId,
    callId: state.callId,
    recordId: state.recordId,
    caseNumber: state.caseNumber,
    deps,
  });
  await deps.store.enqueueInbox(inbox);
  await deps.store.putRecording({
    id: inbox.id,
    providerRecordingId: file.fileId,
    inboxId: inbox.id,
    state: 'fetched',
    distortedSha256: null,
    bytes: null,
    createdAt: deps.now(),
    expiresAt: addMinutes(deps.now(), deps.config.audioTtlMinutes),
  });
}

async function finishCall(event: ProviderEvent, deps: PipelineDeps): Promise<void> {
  const id = callId(event);
  if (!id) return;
  const state = await deps.store.getCall(id);
  if (!state || state.step === 'done') return;
  for (const file of await deps.provider.listRecordings(id)) {
    await enqueueRecording(state, file, deps);
  }
  await deps.store.markCallStep(id, 'done', deps.now());
}

async function recordingStopped(event: ProviderEvent, deps: PipelineDeps): Promise<void> {
  const id = callId(event);
  if (!id) return;
  const state = await deps.store.getCall(id);
  if (!state) return;
  for (const file of recordingFiles(event)) await enqueueRecording(state, file, deps);
}

export async function handleVoiceEvent(event: ProviderEvent, deps: PipelineDeps): Promise<void> {
  if (event.eventType === INFOBIP_EVENT_TYPES.callReceived) {
    await handleCallReceived(event, deps);
  } else if (event.eventType === INFOBIP_EVENT_TYPES.callEstablished) {
    await handleCallEstablished(event, deps);
  } else if (event.eventType === INFOBIP_EVENT_TYPES.sayFinished) {
    await handleSayFinished(event, deps);
  } else if (
    event.eventType === INFOBIP_EVENT_TYPES.callFinished ||
    event.eventType === INFOBIP_EVENT_TYPES.callFailed
  ) {
    await finishCall(event, deps);
  } else if (
    event.eventType === INFOBIP_EVENT_TYPES.callRecordingStopped ||
    event.eventType === INFOBIP_EVENT_TYPES.recordingStopped
  ) {
    await recordingStopped(event, deps);
  } else {
    deps.log({
      service: 'channel-gateway',
      stage: 'voice-webhook',
      code: 'ignored_event',
      eventId: event.id,
    });
  }
}

async function reopenKeyForRecord(recordId: string, deps: PipelineDeps): Promise<string> {
  const link = await deps.store.findLinkByRecord(recordId);
  if (!link) throw new Error('voice link is missing');
  const key = deps.config.vaultKeys.get(link.keyVersion);
  if (!key) throw new Error('voice link key is missing');
  return openString(
    key,
    {
      ciphertext: Buffer.from(link.reopenKeyCiphertext),
      nonce: Buffer.from(link.reopenKeyNonce),
      tag: Buffer.from(link.reopenKeyTag),
    },
    'reopen-key',
  );
}

async function deleteProviderRecording(deps: PipelineDeps, fileId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await deps.provider.deleteRecording(fileId);
      return true;
    } catch {
      // Retry once because deletion is custody cleanup, not a transcription outcome.
    }
  }
  return false;
}

async function completeRecordingCustody(
  row: InboxRow,
  deps: PipelineDeps,
  fileId: string,
): Promise<void> {
  if (await deleteProviderRecording(deps, fileId)) {
    await deps.store.completeInbox(row.id, {
      recordId: row.recordId,
      caseNumber: row.caseNumber,
    });
    return;
  }
  await deps.store.failInbox(
    row.id,
    'provider recording deletion failed',
    addMinutes(deps.now(), 5),
  );
  deps.log({
    service: 'channel-gateway',
    stage: 'voice',
    code: 'provider_recording_delete_failed',
    recordId: row.recordId ?? undefined,
    caseNumber: row.caseNumber ?? undefined,
    error: 'recording_delete_failed',
  });
}

// Privacy ordering: non-Infobip STT sees original bytes only in memory, then distortion runs,
// the original is zeroed, and only distorted bytes may persist. The original never persists and
// never leaves the gateway except to the STT endpoint chosen under the processing agreement.
export async function handleRecordingSaved(row: InboxRow, deps: PipelineDeps): Promise<void> {
  if (
    row.kind !== 'voice_recording' ||
    !row.providerRef ||
    !row.callControlId ||
    !row.caseNumber ||
    !row.recordId
  )
    return;

  const maxBytes =
    deps.config.stt?.maxBytes ??
    Math.max(1024, deps.config.maxRecordingSeconds * RECORDING_MAX_BYTES_PER_SECOND);
  const recording = await deps.store.getRecording(row.id);
  const recordingId = recording?.providerRecordingId;
  const providerFileId = recording?.providerRecordingId ?? row.providerRef;
  if (recording && (recording.state === 'transcribed' || recording.state === 'discarded')) {
    await completeRecordingCustody(row, deps, providerFileId);
    return;
  }
  let providerDeleted = false;
  let original: Uint8Array | null = null;
  let reopenKey = '';
  try {
    original = await deps.provider.fetchRecording(
      row.providerRef,
      maxBytes,
      RECORDING_DOWNLOAD_TIMEOUT_MS,
    );
    reopenKey = await reopenKeyForRecord(row.recordId, deps);
    if (!original) throw new Error('recording download returned no bytes');
    const transcript = await deps.stt?.transcribe({
      audio: original,
      mimeType: 'audio/wav',
      languageHint: 'hr',
      ...(recordingId ? { providerFileId: recordingId } : {}),
    });
    if (!transcript) throw new Error('STT provider is not configured');
    const seed = recordingId ?? row.id;
    const distorted = distortRecording(original, { semitones: deps.config.distortSemitones, seed });
    original.fill(0);
    await deps.store.updateRecording(row.id, {
      state: 'distorted',
      distortedSha256: distorted.sha256,
      bytes: deps.config.audioSink === 'gateway' ? distorted.bytes : null,
      expiresAt: addMinutes(deps.now(), deps.config.audioTtlMinutes),
    });
    await deps.trace.appendChannelMessage(
      row.caseNumber,
      {
        reopenKey,
        channel: 'voice',
        kind: 'transcript',
        text: transcript.text,
        source: 'transcript',
        occurredAt: deps.now().toISOString(),
      },
      row.id,
    );
    if (deps.config.audioSink === 'gateway') {
      await deps.store.updateRecording(row.id, { state: 'transcribed' });
    } else {
      await deps.store.updateRecording(row.id, { state: 'discarded', bytes: null });
    }
    if (deps.config.audioSink === 'trace') {
      deps.log({
        service: 'channel-gateway',
        stage: 'voice',
        code: 'sink_unsupported',
        phoneHashPrefix: phoneHashPrefix(row.phoneHash),
        recordId: row.recordId,
        caseNumber: row.caseNumber,
      });
    }

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
    deps.log({
      service: 'channel-gateway',
      stage: 'voice',
      code: 'transcribed',
      phoneHashPrefix: phoneHashPrefix(row.phoneHash),
      recordId: row.recordId,
      caseNumber: row.caseNumber,
    });
  } catch (cause) {
    if (original) original.fill(0);
    providerDeleted = await deleteProviderRecording(deps, providerFileId);
    if (!providerDeleted) {
      deps.log({
        service: 'channel-gateway',
        stage: 'voice',
        code: 'provider_recording_delete_failed',
        recordId: row.recordId,
        caseNumber: row.caseNumber,
        error: 'recording_delete_failed',
      });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!reopenKey) {
      try {
        reopenKey = await reopenKeyForRecord(row.recordId, deps);
      } catch {
        // A missing link prevents trace notification, but local failure state still persists.
      }
    }
    if (reopenKey) {
      try {
        await deps.trace.appendChannelMessage(
          row.caseNumber,
          {
            reopenKey,
            channel: 'voice',
            kind: 'transcript-failed',
            text: TRANSCRIPT_FAILED_TEXT,
            source: 'system',
            occurredAt: deps.now().toISOString(),
          },
          `${row.id}:failed`,
        );
      } catch (error) {
        deps.log({
          service: 'channel-gateway',
          stage: 'voice',
          code: 'transcript_failure_notification_failed',
          recordId: row.recordId,
          caseNumber: row.caseNumber,
          error: error instanceof Error ? error.message : 'trace_notification_failed',
        });
      }
    }
    await deps.store.updateRecording(row.id, { state: 'failed', bytes: null });
    if (providerDeleted) {
      await deps.store.completeInbox(row.id, {
        recordId: row.recordId,
        caseNumber: row.caseNumber,
      });
    } else {
      await deps.store.failInbox(row.id, message, addMinutes(deps.now(), 5));
    }
    deps.log({
      service: 'channel-gateway',
      stage: 'voice',
      code: 'transcript_failed',
      phoneHashPrefix: phoneHashPrefix(row.phoneHash),
      recordId: row.recordId,
      caseNumber: row.caseNumber,
      error: message,
    });
    return;
  }
  await completeRecordingCustody(row, deps, providerFileId);
}

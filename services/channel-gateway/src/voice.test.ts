// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { generateTone } from './audio/wav.js';
import { SMS_CONFIRM } from './copy-hr.js';
import { openString, phoneHash } from './crypto.js';
import { MemoryChannelStore } from './memory-store.js';
import type { ChannelProvider, PipelineDeps, RecordStartInput, SendSmsInput, SpeakInput, SttProvider, TelnyxEvent } from './pipeline-types.js';
import type { ChannelStore } from './store.js';
import type { ChannelInbox } from './types.js';
import { handleRecordingSaved, handleVoiceEvent } from './voice.js';

const key = Buffer.from('0123456789abcdef0123456789abcdef');
const now = new Date('2026-09-12T12:00:00.000Z');

class StubProvider implements ChannelProvider {
  readonly name = 'stub' as const;
  readonly answers: Array<{ callControlId: string; clientState: string }> = [];
  readonly speaks: Array<{ callControlId: string; input: SpeakInput }> = [];
  readonly records: Array<{ callControlId: string; input: RecordStartInput }> = [];
  readonly hangups: string[] = [];
  readonly deletes: string[] = [];
  recordingBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  lastFetch: { url: string; maxBytes: number; timeoutMs: number } | null = null;

  async sendSms(_input: SendSmsInput): Promise<{ providerMessageId: string }> {
    return { providerMessageId: 'unused' };
  }

  async answerCall(callControlId: string, clientState: string): Promise<void> {
    this.answers.push({ callControlId, clientState });
  }

  async speak(callControlId: string, input: SpeakInput): Promise<void> {
    this.speaks.push({ callControlId, input });
  }

  async recordStart(callControlId: string, input: RecordStartInput): Promise<void> {
    this.records.push({ callControlId, input });
  }

  async hangup(callControlId: string): Promise<void> {
    this.hangups.push(callControlId);
  }

  async fetchRecording(url: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array> {
    this.lastFetch = { url, maxBytes, timeoutMs };
    return this.recordingBytes;
  }

  async deleteRecording(recordingId: string): Promise<void> {
    this.deletes.push(recordingId);
  }
}

class StubStt implements SttProvider {
  readonly name = 'stub' as const;
  fail = false;

  async transcribe(_input: { audio: Uint8Array; mimeType: 'audio/wav'; languageHint: 'hr' }): Promise<{ text: string; durationSeconds: number | null }> {
    if (this.fail) throw new Error('stt failed');
    return { text: 'Ulična rasvjeta ne radi u ulici Primjer, već tri dana.', durationSeconds: 1 };
  }
}

interface Fixture {
  deps: PipelineDeps;
  store: ChannelStore;
  provider: StubProvider;
  stt: StubStt;
  traceMessages: Array<{ kind: string; text: string | null }>;
  traceCases: unknown[];
  auditEvents: Array<{ eventType: string; code: string }>;
  logs: Array<{ code: string }>;
}

function event(eventType: string, payload: Record<string, unknown>, id = `${eventType}-id`): TelnyxEvent {
  return { id, eventType, occurredAt: now.toISOString(), payload, payloadSha256: `${id}-sha` };
}

function parseState(value: string | undefined): Record<string, unknown> {
  assert.ok(value);
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Record<string, unknown>;
}

function fixture(): Fixture {
  const store = new MemoryChannelStore();
  const provider = new StubProvider();
  const stt = new StubStt();
  const traceMessages: Array<{ kind: string; text: string | null }> = [];
  const traceCases: unknown[] = [];
  const auditEvents: Array<{ eventType: string; code: string }> = [];
  const logs: Array<{ code: string }> = [];
  const deps: PipelineDeps = {
    config: {
      internalApiToken: 'token',
      databaseUrl: 'postgres://localhost/polis',
      traceInternalUrl: 'http://127.0.0.1:8980',
      traceGatewayActorId: 'gateway',
      municipalityId: 'vrsar-orsera',
      deploymentProfile: 'dev',
      channelProvider: 'stub',
      sttProvider: 'stub',
      processingAgreement: false,
      vaultKeys: new Map([[1, key]]),
      activeVaultKeyVersion: 1,
      vaultPepper: 'pepper',
      auditInternalUrl: 'http://127.0.0.1:8981',
      stt: { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'stt-key', model: 'whisper', timeoutMs: 1000, maxBytes: 123_456 },
      audioSink: 'gateway',
      distortSemitones: -4,
      maxRecordingSeconds: 5,
      maxInboundChars: 1000,
      vaultTtlDays: 30,
      eventTtlHours: 24,
      audioTtlMinutes: 10,
      purgeIntervalMs: 60_000,
      relayIntervalMs: 1000,
      ackAppends: true,
      inboundPerHashPerHour: 20,
      newCasesPerHashPerDay: 5,
      outboundPerCasePerHour: 5,
      outboundPerHashPerDay: 20,
      outboundPerMinute: 30,
      outboundMaxAttempts: 3,
      allowStubInjection: true,
      telnyx: {
        numberE164: '+385911111111',
        apiKey: 'key',
        publicKey: Buffer.alloc(32).toString('base64'),
        messagingProfileId: 'profile',
        connectionId: 'connection',
        ttsVoice: 'Azure.hr-HR-GabrijelaNeural',
        signatureToleranceSeconds: 300,
      },
    },
    store,
    provider,
    stt,
    now: () => now,
    log: (fields) => logs.push({ code: fields.code }),
    audit: { emit: async (input) => { auditEvents.push({ eventType: input.eventType, code: input.code }); } },
    trace: {
      createChannelCase: async (input, _idempotencyKey) => {
        traceCases.push(input);
        return { case: { recordId: 'rec-voice-1', caseNumber: 'CASE-123', reopenKey: 'reopen-secret', state: 'open' } };
      },
      appendChannelMessage: async (_caseNumber, input, _idempotencyKey) => {
        traceMessages.push({ kind: input.kind, text: input.text });
        return { message: { id: `msg-${traceMessages.length}` } };
      },
      listOutbox: async () => ({ messages: [] }),
      markDelivery: async () => {},
    },
  };
  return { deps, store, provider, stt, traceMessages, traceCases, auditEvents, logs };
}

async function runAnsweredSequence(deps: PipelineDeps, provider: StubProvider): Promise<void> {
  await handleVoiceEvent(event('call.initiated', { direction: 'incoming', call_control_id: 'call-1', from: '+385911234567' }, 'evt-init'), deps);
  await handleVoiceEvent(event('call.answered', { call_control_id: 'call-1', from: '+385911234567' }, 'evt-answered'), deps);
  await handleVoiceEvent(event('call.speak.ended', { call_control_id: 'call-1', client_state: provider.speaks[0]!.input.clientState }, 'evt-speak-ended'), deps);
}

test('voice call sequence creates identity, case, link, one prompt/readback speak, then recording', async () => {
  const { deps, provider, traceCases } = fixture();
  await runAnsweredSequence(deps, provider);

  assert.equal(provider.answers.length, 1);
  assert.equal(traceCases.length, 1);
  assert.equal(provider.speaks.length, 1);
  assert.match(provider.speaks[0]!.input.text, /automatska prijava/);
  assert.match(provider.speaks[0]!.input.text, /CASE-123/);
  assert.match(provider.speaks[0]!.input.text, /jedan, dva, tri/);
  assert.equal(provider.records.length, 1);
  assert.equal(provider.records[0]!.input.playBeep, true);
  assert.deepEqual(parseState(provider.records[0]!.input.clientState), { v: 1, eventId: 'evt-speak-ended', step: 'recording', caseNumber: 'CASE-123', recordId: 'rec-voice-1' });
});

test('voice handler does not own event dedupe or markEvent state', async () => {
  const { deps, provider } = fixture();
  const initiated = event('call.initiated', { direction: 'incoming', call_control_id: 'call-1' }, 'evt-init');
  await handleVoiceEvent(initiated, deps);
  await handleVoiceEvent(initiated, deps);
  assert.equal(provider.answers.length, 2);
});

test('recording.saved transcribes distorted audio, deletes provider recording id, zeros original, and confirms', async () => {
  const { deps, store, provider, traceMessages } = fixture();
  await runAnsweredSequence(deps, provider);
  const original = generateTone(0.25, 440, 16_000);
  provider.recordingBytes = original;

  await handleVoiceEvent(
    event('call.recording.saved', {
      call_control_id: 'call-1',
      recording_id: 'recording-1',
      recording_urls: { wav: 'https://api.telnyx.test/download/not-the-id' },
      client_state: provider.records[0]!.input.clientState,
    }, 'evt-recording'),
    deps,
  );
  const [row] = await store.claimInbox(now, 10) as ChannelInbox[];
  assert.equal(row!.kind, 'voice_recording');
  await handleRecordingSaved(row!, deps);

  assert.equal(provider.lastFetch?.maxBytes, 123_456);
  assert.equal(provider.lastFetch?.timeoutMs, 30_000);
  assert.deepEqual(provider.deletes, ['recording-1']);
  assert.ok(original.every((byte) => byte === 0));
  assert.deepEqual(traceMessages, [{ kind: 'transcript', text: 'Ulična rasvjeta ne radi u ulici Primjer, već tri dana.' }]);
  const recording = await store.getRecording(row!.id);
  assert.equal(recording?.state, 'transcribed');
  assert.ok(recording?.distortedSha256);
  assert.ok(recording?.bytes && recording.bytes.byteLength > 0);
  const outbox = await store.claimOutbox(now, 10);
  assert.equal(outbox.length, 1);
  assert.equal(openString(key, { ciphertext: Buffer.from(outbox[0]!.bodyCiphertext), nonce: Buffer.from(outbox[0]!.bodyNonce), tag: Buffer.from(outbox[0]!.bodyTag) }, 'outbox-body'), SMS_CONFIRM('CASE-123'));
});

test('distorted hash is deterministic for same provider recording id seed', async () => {
  const hashes: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const { deps, store, provider } = fixture();
    await runAnsweredSequence(deps, provider);
    provider.recordingBytes = generateTone(0.25, 440, 16_000);
    await handleVoiceEvent(
      event('call.recording.saved', {
        call_control_id: 'call-1',
        recording_id: 'recording-1',
        recording_urls: { wav: 'https://api.telnyx.test/download/a' },
        client_state: provider.records[0]!.input.clientState,
      }, 'evt-recording'),
      deps,
    );
    const [row] = await store.claimInbox(now, 10) as ChannelInbox[];
    await handleRecordingSaved(row!, deps);
    hashes.push((await store.getRecording(row!.id))!.distortedSha256!);
  }
  assert.equal(hashes[0], hashes[1]);
});

test('blocked identity hangs up without creating a case', async () => {
  const { deps, store, provider, traceCases } = fixture();
  const hash = phoneHash('+385911234567', deps.config.vaultPepper, deps.config.municipalityId);
  await store.upsertIdentity({
    phoneHash: hash,
    phoneCiphertext: randomBytes(8),
    phoneNonce: randomBytes(12),
    phoneTag: randomBytes(16),
    keyVersion: 1,
    municipalityId: deps.config.municipalityId,
    firstSeenAt: now,
    lastSeenAt: now,
    expiresAt: now,
    blocked: true,
  });

  await handleVoiceEvent(event('call.answered', { call_control_id: 'call-1', from: '+385911234567' }, 'evt-blocked'), deps);

  assert.deepEqual(provider.hangups, ['call-1']);
  assert.equal(traceCases.length, 0);
  assert.equal(provider.speaks.length, 0);
});

test('recording.error fails deterministic voice_call row, audits, and hangs up', async () => {
  const { deps, store, provider, traceMessages, auditEvents } = fixture();
  await runAnsweredSequence(deps, provider);

  await handleVoiceEvent(
    event('call.recording.error', { call_control_id: 'call-1', client_state: provider.records[0]!.input.clientState }, 'evt-recording-error'),
    deps,
  );

  const [failedCall] = await store.claimInbox(now, 10) as ChannelInbox[];
  assert.equal(failedCall!.id, 'voice-call:call-1');
  assert.equal(failedCall!.state, 'processing');
  assert.equal(failedCall!.attempts, 1);
  assert.deepEqual(provider.hangups, ['call-1']);
  assert.deepEqual(traceMessages, []);
  assert.deepEqual(auditEvents, [{ eventType: 'channel.voice.recording_error', code: 'recording_error' }]);
});

test('STT failure appends transcript-failed text, fails inbox, discards audio, and still deletes recording', async () => {
  const { deps, store, provider, stt, traceMessages } = fixture();
  stt.fail = true;
  await runAnsweredSequence(deps, provider);
  const original = generateTone(0.25, 440, 16_000);
  provider.recordingBytes = original;
  await handleVoiceEvent(
    event('call.recording.saved', {
      call_control_id: 'call-1',
      recording_id: 'recording-1',
      recording_urls: { wav: 'https://api.telnyx.test/download/a' },
      client_state: provider.records[0]!.input.clientState,
    }, 'evt-recording'),
    deps,
  );
  const [row] = await store.claimInbox(now, 10) as ChannelInbox[];
  await handleRecordingSaved(row!, deps);

  assert.deepEqual(provider.deletes, ['recording-1']);
  assert.ok(original.every((byte) => byte === 0));
  assert.deepEqual(traceMessages, [{ kind: 'transcript-failed', text: 'Transkripcija glasovne prijave nije uspjela.' }]);
  assert.equal((await store.getRecording(row!.id))?.state, 'failed');
  assert.equal((await store.claimInbox(new Date(now.getTime() + 6 * 60 * 1000), 10))[0]?.state, 'processing');
});
test('discard and trace audio sinks do not retain distorted bytes; trace logs unsupported sink', async () => {
  for (const sink of ['discard', 'trace'] as const) {
    const { deps, store, provider, logs } = fixture();
    deps.config.audioSink = sink;
    await runAnsweredSequence(deps, provider);
    provider.recordingBytes = generateTone(0.25, 440, 16_000);
    await handleVoiceEvent(
      event('call.recording.saved', {
        call_control_id: 'call-1',
        recording_id: `recording-${sink}`,
        recording_urls: { wav: 'https://api.telnyx.test/download/a' },
        client_state: provider.records[0]!.input.clientState,
      }, `evt-recording-${sink}`),
      deps,
    );
    const [row] = await store.claimInbox(now, 10) as ChannelInbox[];
    await handleRecordingSaved(row!, deps);
    const recording = await store.getRecording(row!.id);
    assert.equal(recording?.state, 'discarded');
    assert.equal(recording?.bytes, null);
    assert.equal(logs.some((entry) => entry.code === 'sink_unsupported'), sink === 'trace');
  }
});

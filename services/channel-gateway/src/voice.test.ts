// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTone } from './audio/wav.js';
import { PROMPT_HR } from './copy-hr.js';
import { MemoryChannelStore } from './memory-store.js';
import type {
  ChannelProvider,
  PipelineDeps,
  ProviderEvent,
  RecordStartInput,
  SendSmsInput,
  SpeakInput,
  SttProvider,
} from './pipeline-types.js';
import type { ChannelInbox } from './types.js';
import { handleRecordingSaved, handleVoiceEvent } from './voice.js';

const key = Buffer.from('0123456789abcdef0123456789abcdef');
const now = new Date('2026-09-12T12:00:00.000Z');
const phone = ['+385', '91', '111', '1111'].join('');

class StubProvider implements ChannelProvider {
  readonly name = 'stub' as const;
  readonly answers: string[] = [];
  readonly speaks: Array<{ callId: string; input: SpeakInput }> = [];
  readonly records: Array<{ callId: string; input: RecordStartInput }> = [];
  readonly hangups: string[] = [];
  readonly deletes: string[] = [];
  readonly deleteAttempts: string[] = [];
  deleteFailuresRemaining = 0;
  files: Array<{ fileId: string; durationSeconds: number | null }> = [];
  recordingBytes = generateTone(0.25, 440, 16_000);

  async sendSms(_input: SendSmsInput): Promise<{ providerMessageId: string }> {
    return { providerMessageId: 'unused' };
  }

  async answerCall(callId: string): Promise<void> {
    this.answers.push(callId);
  }

  async speak(callId: string, input: SpeakInput): Promise<void> {
    this.speaks.push({ callId, input });
  }

  async recordStart(callId: string, input: RecordStartInput): Promise<void> {
    this.records.push({ callId, input });
  }

  async hangup(callId: string): Promise<void> {
    this.hangups.push(callId);
  }

  async listRecordings(): Promise<Array<{ fileId: string; durationSeconds: number | null }>> {
    return this.files;
  }

  async fetchRecording(): Promise<Uint8Array> {
    return this.recordingBytes;
  }

  async deleteRecording(fileId: string): Promise<void> {
    this.deleteAttempts.push(fileId);
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error('delete failed');
    }
    this.deletes.push(fileId);
  }
}

class StubStt implements SttProvider {
  name: SttProvider['name'] = 'stub';
  seenAudio: Uint8Array | null = null;
  seenProviderFileId: string | undefined;
  fail = false;
  calls = 0;

  async transcribe(input: {
    audio: Uint8Array;
    mimeType: 'audio/wav';
    languageHint: 'hr';
    providerFileId?: string;
  }): Promise<{ text: string; durationSeconds: number | null }> {
    this.calls += 1;
    this.seenAudio = new Uint8Array(input.audio);
    if (this.fail) throw new Error('stt failed');
    this.seenProviderFileId = input.providerFileId;
    return { text: 'Ulična rasvjeta ne radi.', durationSeconds: 1 };
  }
}

function fixture() {
  const store = new MemoryChannelStore();
  const provider = new StubProvider();
  const stt = new StubStt();
  const traceMessages: Array<{ kind: string; text: string | null }> = [];
  const logs: Array<{ code: string; eventId?: string }> = [];
  const deps: PipelineDeps = {
    config: {
      internalApiToken: 'token',
      databaseUrl: 'postgres://localhost/polis',
      traceInternalUrl: 'http://127.0.0.1:8980',
      traceGatewayActorId: 'gateway',
      municipalityId: 'vrsar-orsera',
      deploymentProfile: 'dev',
      channelProvider: 'infobip',
      sttProvider: 'stub',
      processingAgreement: true,
      vaultKeys: new Map([[1, key]]),
      activeVaultKeyVersion: 1,
      vaultPepper: 'a-distinct-phone-vault-pepper-value',
      auditInternalUrl: 'http://127.0.0.1:8981',
      infobip: {
        baseUrl: 'https://account.api.infobip.com/',
        apiKey: 'key',
        webhookSecret: 'a-real-webhook-secret-at-least-32-characters',
        webhookSignatureHeader: 'x-hub-signature',
        sender: '+385981234567',
        callsConfigurationId: 'calls-1',
        ttsLanguage: 'hr',
        ttsVoice: 'Ivana',
      },
      audioSink: 'gateway',
      distortSemitones: -4,
      maxRecordingSeconds: 180,
      maxInboundChars: 1600,
      vaultTtlDays: 30,
      eventTtlHours: 24,
      audioTtlMinutes: 30,
      purgeIntervalMs: 60_000,
      relayIntervalMs: 15_000,
      ackAppends: false,
      inboundPerHashPerHour: 20,
      newCasesPerHashPerDay: 5,
      outboundPerCasePerHour: 5,
      outboundPerHashPerDay: 20,
      outboundPerMinute: 30,
      outboundMaxAttempts: 3,
      allowStubInjection: false,
    },
    store,
    provider,
    stt,
    trace: {
      async createChannelCase() {
        return {
          case: {
            recordId: '11111111-1111-4111-8111-111111111111',
            caseNumber: 'VRS-42',
            reopenKey: 'reopen-key',
            state: 'open',
          },
        };
      },
      async appendChannelMessage(_caseNumber, input) {
        traceMessages.push({ kind: input.kind, text: input.text });
        return { message: { id: 'message-1' } };
      },
      async listOutbox() {
        return { messages: [] };
      },
      async markDelivery() {},
    },
    audit: { async emit() {} },
    log(fields) {
      logs.push({ code: fields.code, ...(fields.eventId ? { eventId: fields.eventId } : {}) });
    },
    now: () => now,
  };
  return { deps, store, provider, stt, traceMessages, logs };
}

function event(
  eventType: string,
  properties: Record<string, unknown>,
  id = `${eventType}-id`,
): ProviderEvent {
  return {
    id,
    eventType,
    occurredAt: now.toISOString(),
    payload: { callId: 'call-1', type: eventType, timestamp: now.toISOString(), properties },
    payloadSha256: 'a'.repeat(64),
  };
}

async function establish(subject: { deps: PipelineDeps }): Promise<void> {
  const call = { id: 'call-1', direction: 'INBOUND', from: phone, to: '+385981234567' };
  await handleVoiceEvent(event('CALL_RECEIVED', { call }), subject.deps);
  await handleVoiceEvent(event('CALL_ESTABLISHED', { call }), subject.deps);
}

test('Infobip call events persist state and drive answer, prompt, recording, and readback', async () => {
  const subject = fixture();
  await establish(subject);
  assert.deepEqual(subject.provider.answers, ['call-1']);
  assert.equal((await subject.store.getCall('call-1'))?.step, 'prompt');
  assert.deepEqual(subject.provider.speaks[0], {
    callId: 'call-1',
    input: { text: PROMPT_HR, language: 'hr', voice: 'Ivana' },
  });

  await handleVoiceEvent(event('SAY_FINISHED', {}), subject.deps);
  assert.deepEqual(subject.provider.records, [
    { callId: 'call-1', input: { maxLengthSeconds: 180, transcription: false } },
  ]);
  assert.match(subject.provider.speaks[1]!.input.text, /VRS-42/);
  assert.equal((await subject.store.getCall('call-1'))?.step, 'readback');
  await handleVoiceEvent(event('SAY_FINISHED', {}, 'say-finished-2'), subject.deps);
  assert.equal((await subject.store.getCall('call-1'))?.step, 'recording');
});

test('recording-stopped and terminal events enqueue direct and listed files', async () => {
  const subject = fixture();
  await establish(subject);
  await handleVoiceEvent(
    event('CALL_RECORDING_STOPPED', {
      recording: { files: [{ fileId: 'file-direct', durationSeconds: 2 }] },
    }),
    subject.deps,
  );
  assert.equal((await subject.store.claimInbox(now, 10))[0]?.providerRef, 'file-direct');
  subject.provider.files = [{ fileId: 'file-direct', durationSeconds: 2 }];
  await handleVoiceEvent(event('CALL_FINISHED', {}, 'finished-after-direct'), subject.deps);
  assert.deepEqual(await subject.store.claimInbox(now, 10), []);

  const terminal = fixture();
  await establish(terminal);
  terminal.provider.files = [{ fileId: 'file-listed', durationSeconds: null }];
  await handleVoiceEvent(event('CALL_FINISHED', {}), terminal.deps);
  assert.equal((await terminal.store.getCall('call-1'))?.step, 'done');
  assert.equal((await terminal.store.claimInbox(now, 10))[0]?.providerRef, 'file-listed');
});

test('unknown call events log ignored_event without exposing a number', async () => {
  const subject = fixture();
  await handleVoiceEvent(event('UNSUPPORTED_EVENT', {}), subject.deps);
  assert.deepEqual(subject.logs, [{ code: 'ignored_event', eventId: 'UNSUPPORTED_EVENT-id' }]);
  assert.equal(
    subject.logs.some((entry) => /\\+?\\d{8,}/.test(JSON.stringify(entry))),
    false,
  );
});

test('recording custody transcribes original bytes, distorts, zeroes, stores, and deletes', async () => {
  const subject = fixture();
  await establish(subject);
  const original = subject.provider.recordingBytes;
  await handleVoiceEvent(
    event('CALL_RECORDING_STOPPED', {
      recording: { files: [{ fileId: 'file-1', durationSeconds: 1 }] },
    }),
    subject.deps,
  );
  const [row] = (await subject.store.claimInbox(now, 10)) as ChannelInbox[];
  assert.ok(row);
  await handleRecordingSaved(row, subject.deps);
  assert.ok(subject.stt.seenAudio);
  assert.notEqual(
    subject.stt.seenAudio!.every((byte) => byte === 0),
    true,
  );
  assert.equal(
    original.every((byte) => byte === 0),
    true,
  );
  assert.equal(subject.stt.seenProviderFileId, 'file-1');
  assert.deepEqual(subject.provider.deletes, ['file-1']);
  const recording = await subject.store.getRecording(row.id);
  assert.equal(recording?.state, 'transcribed');
  assert.match(recording?.distortedSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(recording?.bytes);
  assert.deepEqual(subject.traceMessages, [
    { kind: 'transcript', text: 'Ulična rasvjeta ne radi.' },
  ]);
});

test('a transient provider deletion failure preserves the valid transcript', async () => {
  const subject = fixture();
  subject.provider.deleteFailuresRemaining = 1;
  await establish(subject);
  await handleVoiceEvent(
    event('CALL_RECORDING_STOPPED', {
      recording: { files: [{ fileId: 'file-delete-retry', durationSeconds: 1 }] },
    }),
    subject.deps,
  );
  const [row] = (await subject.store.claimInbox(now, 10)) as ChannelInbox[];
  await handleRecordingSaved(row!, subject.deps);
  assert.deepEqual(subject.provider.deleteAttempts, ['file-delete-retry', 'file-delete-retry']);
  assert.deepEqual(subject.provider.deletes, ['file-delete-retry']);
  assert.equal((await subject.store.getRecording(row!.id))?.state, 'transcribed');
  assert.deepEqual(subject.traceMessages, [
    { kind: 'transcript', text: 'Ulična rasvjeta ne radi.' },
  ]);
});

test('persistent deletion failure reschedules deletion without retranscribing', async () => {
  const subject = fixture();
  subject.provider.deleteFailuresRemaining = 2;
  await establish(subject);
  await handleVoiceEvent(
    event('CALL_RECORDING_STOPPED', {
      recording: { files: [{ fileId: 'file-delete-later', durationSeconds: 1 }] },
    }),
    subject.deps,
  );
  const [row] = (await subject.store.claimInbox(now, 10)) as ChannelInbox[];
  await handleRecordingSaved(row!, subject.deps);
  assert.equal(subject.stt.calls, 1);
  assert.deepEqual(subject.traceMessages, [
    { kind: 'transcript', text: 'Ulična rasvjeta ne radi.' },
  ]);
  assert.deepEqual(subject.provider.deletes, []);

  const retryAt = new Date(now.getTime() + 5 * 60_000);
  const [retry] = (await subject.store.claimInbox(retryAt, 10)) as ChannelInbox[];
  await handleRecordingSaved(retry!, subject.deps);
  assert.equal(subject.stt.calls, 1);
  assert.deepEqual(subject.traceMessages, [
    { kind: 'transcript', text: 'Ulična rasvjeta ne radi.' },
  ]);
  assert.deepEqual(subject.provider.deletes, ['file-delete-later']);
  assert.deepEqual(await subject.store.claimInbox(new Date(retryAt.getTime() + 1), 10), []);
});

test('STT failure deletes the source and completes the unretryable inbox item', async () => {
  const subject = fixture();
  subject.stt.fail = true;
  await establish(subject);
  await handleVoiceEvent(
    event('CALL_RECORDING_STOPPED', {
      recording: { files: [{ fileId: 'file-failed', durationSeconds: 1 }] },
    }),
    subject.deps,
  );
  const [row] = (await subject.store.claimInbox(now, 10)) as ChannelInbox[];
  await handleRecordingSaved(row!, subject.deps);
  assert.deepEqual(subject.provider.deletes, ['file-failed']);
  assert.equal((await subject.store.getRecording(row!.id))?.state, 'failed');
  assert.deepEqual(await subject.store.claimInbox(new Date(now.getTime() + 10 * 60_000), 10), []);
  assert.deepEqual(subject.traceMessages, [
    {
      kind: 'transcript-failed',
      text: 'Transkripcija glasovne prijave nije uspjela.',
    },
  ]);
});

test('Infobip STT requests provider transcription before deleting its recording', async () => {
  const subject = fixture();
  subject.deps.config.sttProvider = 'infobip';
  subject.stt.name = 'infobip';
  await establish(subject);
  await handleVoiceEvent(
    event('RECORDING_STOPPED', {
      recording: { files: [{ fileId: 'file-infobip', durationSeconds: null }] },
    }),
    subject.deps,
  );
  const [row] = (await subject.store.claimInbox(now, 10)) as ChannelInbox[];
  await handleRecordingSaved(row!, subject.deps);
  assert.equal(subject.stt.seenProviderFileId, 'file-infobip');
  assert.deepEqual(subject.provider.deletes, ['file-infobip']);
});

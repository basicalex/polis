// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChannelConfig, SttConfig } from './config.js';
import { createOpenAiSttProvider } from './openai-stt.js';
import { createSttProvider, SttProviderError } from './stt-provider.js';
import { createStubSttProvider } from './stub-stt.js';

const sttConfig: SttConfig = {
  baseUrl: 'https://stt.example/v1',
  apiKey: 'secret-key',
  model: 'whisper-large-v3',
  timeoutMs: 50,
  maxBytes: 100,
};

test('stub transcript reports duration from the WAV header', async () => {
  const result = await createStubSttProvider().transcribe({
    audio: wavBytes({ seconds: 1.25 }),
    mimeType: 'audio/wav',
    languageHint: 'hr',
  });

  assert.equal(result.text, 'Ulična rasvjeta ne radi u ulici Primjer, već tri dana.');
  assert.equal(result.durationSeconds, 1.25);
});

test('openai-compatible provider posts strict multipart request', async () => {
  const provider = createOpenAiSttProvider(sttConfig, async (input, init) => {
    assert.equal(String(input), 'https://stt.example/v1/audio/transcriptions');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer secret-key');
    assert.ok(init?.body instanceof FormData);
    const form = init.body;
    assert.equal(form.get('model'), 'whisper-large-v3');
    assert.equal(form.get('language'), 'hr');
    assert.equal(form.get('response_format'), 'json');
    const file = form.get('file');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'recording.wav');
    assert.equal(file.type, 'audio/wav');
    assert.equal(await file.text(), 'abc');
    return new Response(JSON.stringify({ text: 'tekst', duration: 3.5 }), { status: 200 });
  });

  assert.deepEqual(
    await provider.transcribe({ audio: new TextEncoder().encode('abc'), mimeType: 'audio/wav', languageHint: 'hr' }),
    { text: 'tekst', durationSeconds: 3.5 },
  );
});

test('openai-compatible provider rejects oversized audio before fetch', async () => {
  let called = false;
  const provider = createOpenAiSttProvider({ ...sttConfig, maxBytes: 2 }, async () => {
    called = true;
    return new Response('{}');
  });

  await assert.rejects(
    provider.transcribe({ audio: new Uint8Array(3), mimeType: 'audio/wav', languageHint: 'hr' }),
    (error) => error instanceof SttProviderError && error.code === 'stt_audio_too_large',
  );
  assert.equal(called, false);
});

test('openai-compatible provider times out with SttProviderError', async () => {
  const provider = createOpenAiSttProvider({ ...sttConfig, timeoutMs: 1 }, (_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  });

  await assert.rejects(
    provider.transcribe({ audio: new Uint8Array(1), mimeType: 'audio/wav', languageHint: 'hr' }),
    (error) => error instanceof SttProviderError && error.code === 'stt_timeout',
  );
});

test('openai-compatible provider rejects non-2xx and malformed responses', async () => {
  const httpProvider = createOpenAiSttProvider(sttConfig, async () => {
    return new Response(JSON.stringify({ error: 'bad' }), { status: 401 });
  });
  await assert.rejects(
    httpProvider.transcribe({ audio: new Uint8Array(1), mimeType: 'audio/wav', languageHint: 'hr' }),
    (error) => error instanceof SttProviderError && error.code === 'stt_http_error' && error.status === 401,
  );

  const malformedProvider = createOpenAiSttProvider(sttConfig, async () => {
    return new Response(JSON.stringify({ text: 1 }), { status: 200 });
  });
  await assert.rejects(
    malformedProvider.transcribe({ audio: new Uint8Array(1), mimeType: 'audio/wav', languageHint: 'hr' }),
    (error) => error instanceof SttProviderError && error.code === 'stt_malformed_response',
  );
});

test('createSttProvider selects exact provider names', () => {
  assert.equal(createSttProvider(channelConfig({ sttProvider: 'stub' })).name, 'stub');
  assert.equal(
    createSttProvider(channelConfig({ sttProvider: 'openai-compatible', stt: sttConfig })).name,
    'openai-compatible',
  );
});

function channelConfig(overrides: Partial<ChannelConfig>): ChannelConfig {
  return {
    internalApiToken: 'internal-secret',
    databaseUrl: 'postgres://channel.test/channel',
    traceInternalUrl: 'http://trace.internal:8980/',
    traceGatewayActorId: 'channel-gateway',
    municipalityId: 'vrsar-orsera',
    deploymentProfile: 'dev',
    channelProvider: 'stub',
    sttProvider: 'stub',
    processingAgreement: false,
    vaultKeys: new Map([[1, Buffer.alloc(32, 1)]]),
    activeVaultKeyVersion: 1,
    vaultPepper: 'a-distinct-phone-vault-pepper-value',
    auditInternalUrl: 'http://audit.internal:8600/',
    audioSink: 'discard',
    distortSemitones: -4,
    maxRecordingSeconds: 180,
    maxInboundChars: 1_600,
    vaultTtlDays: 180,
    eventTtlHours: 168,
    audioTtlMinutes: 60,
    purgeIntervalMs: 3_600_000,
    relayIntervalMs: 15_000,
    ackAppends: false,
    inboundPerHashPerHour: 20,
    newCasesPerHashPerDay: 5,
    outboundPerCasePerHour: 5,
    outboundPerHashPerDay: 20,
    outboundPerMinute: 30,
    outboundMaxAttempts: 3,
    allowStubInjection: false,
    ...overrides,
  };
}

function wavBytes({ seconds }: { seconds: number }): Uint8Array {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataBytes = Math.round(seconds * sampleRate * channels * (bitsPerSample / 8));
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

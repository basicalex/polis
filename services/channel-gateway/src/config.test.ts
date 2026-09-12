// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { parseChannelConfig } from './config.js';

const vaultV1 = Buffer.alloc(32, 1).toString('base64');
const vaultV2 = Buffer.alloc(32, 2).toString('base64');
const baseEnv: NodeJS.ProcessEnv = {
  DEPLOYMENT_PROFILE: 'dev',
  INTERNAL_API_TOKEN: 'internal-secret',
  DATABASE_URL: 'postgres://channel.test/channel',
  TRACE_INTERNAL_URL: 'http://trace.internal:8980',
  TRACE_GATEWAY_ACTOR_ID: 'channel-gateway',
  CHANNEL_MUNICIPALITY_ID: 'vrsar-orsera',
  PHONE_VAULT_KEY: `v2:${vaultV2},v1:${vaultV1}`,
  PHONE_VAULT_PEPPER: 'a-distinct-phone-vault-pepper-value',
};

function parse(overrides: NodeJS.ProcessEnv = {}) {
  return parseChannelConfig({ ...baseEnv, ...overrides });
}

test('development defaults are closed stubs with bounded retention and active key rotation', () => {
  const config = parse();
  assert.equal(config.channelProvider, 'stub');
  assert.equal(config.sttProvider, 'stub');
  assert.equal(config.processingAgreement, false);
  assert.equal(config.activeVaultKeyVersion, 2);
  assert.equal(config.vaultKeys.get(1)?.byteLength, 32);
  assert.equal(config.auditInternalUrl, 'http://localhost:8600/');
  assert.equal(config.audioSink, 'discard');
  assert.equal(config.distortSemitones, -4);
  assert.equal(config.maxRecordingSeconds, 180);
  assert.equal(config.maxInboundChars, 1_600);
  assert.equal(config.vaultTtlDays, 180);
  assert.equal(config.eventTtlHours, 168);
  assert.equal(config.audioTtlMinutes, 60);
  assert.equal(config.purgeIntervalMs, 3_600_000);
  assert.equal(config.relayIntervalMs, 15_000);
  assert.equal(config.ackAppends, false);
  assert.equal(config.inboundPerHashPerHour, 20);
  assert.equal(config.newCasesPerHashPerDay, 5);
  assert.equal(config.outboundPerCasePerHour, 5);
  assert.equal(config.outboundPerHashPerDay, 20);
  assert.equal(config.outboundPerMinute, 30);
  assert.equal(config.outboundMaxAttempts, 3);
  assert.equal(config.allowStubInjection, false);
});

test('required identity, database, URL, actor, municipality, and vault settings fail with their env name', () => {
  const invalid: Array<[string, NodeJS.ProcessEnv]> = [
    ['INTERNAL_API_TOKEN', { INTERNAL_API_TOKEN: '' }],
    ['DATABASE_URL', { DATABASE_URL: 'https://db.test/channel' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgres://db.test' }],
    ['TRACE_INTERNAL_URL', { TRACE_INTERNAL_URL: 'trace.internal' }],
    ['TRACE_INTERNAL_URL', { TRACE_INTERNAL_URL: 'http://user:pass@trace.internal' }],
    ['TRACE_GATEWAY_ACTOR_ID', { TRACE_GATEWAY_ACTOR_ID: 'UPPER CASE' }],
    ['CHANNEL_MUNICIPALITY_ID', { CHANNEL_MUNICIPALITY_ID: 'other' }],
    ['PHONE_VAULT_KEY', { PHONE_VAULT_KEY: 'v1:not-base64' }],
    ['PHONE_VAULT_KEY', { PHONE_VAULT_KEY: `v1:${Buffer.alloc(31).toString('base64')}` }],
    ['PHONE_VAULT_KEY', { PHONE_VAULT_KEY: `v1:${vaultV1},v1:${vaultV2}` }],
    ['PHONE_VAULT_PEPPER', { PHONE_VAULT_PEPPER: 'short' }],
    ['PHONE_VAULT_PEPPER', { PHONE_VAULT_PEPPER: vaultV1, PHONE_VAULT_KEY: `v1:${vaultV1}` }],
    ['AUDIT_INTERNAL_URL', { AUDIT_INTERNAL_URL: 'ftp://audit.internal' }],
  ];
  for (const [key, override] of invalid) {
    assert.throws(() => parse(override), new RegExp(key));
  }
});

test('pilot requires explicit providers and the processing agreement for either real provider', () => {
  assert.throws(() => parse({ DEPLOYMENT_PROFILE: 'pilot' }), /CHANNEL_PROVIDER/);
  assert.throws(
    () => parse({ DEPLOYMENT_PROFILE: 'pilot', CHANNEL_PROVIDER: 'stub' }),
    /STT_PROVIDER/,
  );
  assert.doesNotThrow(() =>
    parse({ DEPLOYMENT_PROFILE: 'pilot', CHANNEL_PROVIDER: 'stub', STT_PROVIDER: 'stub' }),
  );
  assert.throws(
    () => parse({ STT_PROVIDER: 'openai-compatible' }),
    /CHANNEL_PROCESSING_AGREEMENT/,
  );
  assert.throws(() => parse({ CHANNEL_PROVIDER: 'telnyx' }), /CHANNEL_PROCESSING_AGREEMENT/);
});

test('Telnyx settings validate E.164, Ed25519 keys, voice, tolerance, and placeholders', () => {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const telnyx: NodeJS.ProcessEnv = {
    CHANNEL_PROVIDER: 'telnyx',
    CHANNEL_PROCESSING_AGREEMENT: 'true',
    CHANNEL_NUMBER_E164: '+385911234567',
    TELNYX_API_KEY: 'real-telnyx-key',
    TELNYX_PUBLIC_KEY: publicKey,
    TELNYX_MESSAGING_PROFILE_ID: 'profile-1',
    TELNYX_CONNECTION_ID: 'connection-1',
  };
  const config = parse(telnyx);
  assert.equal(config.telnyx?.ttsVoice, 'Azure.hr-HR-GabrijelaNeural');
  assert.equal(config.telnyx?.signatureToleranceSeconds, 300);
  for (const [key, value] of [
    ['CHANNEL_NUMBER_E164', '0911234567'],
    ['TELNYX_PUBLIC_KEY', 'bad'],
    ['TELNYX_TTS_VOICE', 'other.voice'],
    ['TELNYX_SIGNATURE_TOLERANCE_S', '29'],
    ['TELNYX_SIGNATURE_TOLERANCE_S', '901'],
  ]) {
    assert.throws(() => parse({ ...telnyx, [key]: value }), new RegExp(key));
  }
  for (const placeholder of [
    'change-me',
    'stub',
    'example.com',
    'secret.example',
    'secret.invalid',
    'has-placeholder',
  ]) {
    assert.throws(
      () =>
        parse({
          ...telnyx,
          DEPLOYMENT_PROFILE: 'pilot',
          STT_PROVIDER: 'stub',
          TELNYX_API_KEY: placeholder,
        }),
      /TELNYX_API_KEY/,
    );
  }
});

test('openai-compatible STT requires safe transport, credentials, model, and bounds', () => {
  const stt: NodeJS.ProcessEnv = {
    STT_PROVIDER: 'openai-compatible',
    CHANNEL_PROCESSING_AGREEMENT: 'true',
    STT_BASE_URL: 'https://stt.internal/v1',
    STT_API_KEY: 'real-stt-key',
    STT_MODEL: 'whisper-large-v3',
  };
  const config = parse(stt);
  assert.equal(config.stt?.timeoutMs, 30_000);
  assert.equal(config.stt?.maxBytes, 10_000_000);
  assert.doesNotThrow(() => parse({ ...stt, STT_BASE_URL: 'http://127.0.0.1:8000/v1' }));
  for (const [key, value] of [
    ['STT_BASE_URL', 'http://stt.internal/v1'],
    ['STT_BASE_URL', 'https://user:pass@stt.internal/v1'],
    ['STT_API_KEY', ''],
    ['STT_MODEL', ''],
    ['STT_TIMEOUT_MS', '999'],
    ['STT_MAX_BYTES', '0'],
  ]) {
    assert.throws(() => parse({ ...stt, [key]: value }), new RegExp(key));
  }
  assert.throws(
    () =>
      parse({
        ...stt,
        DEPLOYMENT_PROFILE: 'pilot',
        CHANNEL_PROVIDER: 'stub',
        STT_BASE_URL: 'https://speech.invalid/v1',
      }),
    /STT_BASE_URL/,
  );
});

test('tunables reject unsafe enum, boolean, zero distortion, and out-of-range integers', () => {
  const invalid: Array<[string, string]> = [
    ['DEPLOYMENT_PROFILE', 'production'],
    ['CHANNEL_PROVIDER', 'other'],
    ['STT_PROVIDER', 'other'],
    ['CHANNEL_PROCESSING_AGREEMENT', 'yes'],
    ['CHANNEL_AUDIO_SINK', 'disk'],
    ['CHANNEL_DISTORT_SEMITONES', '0'],
    ['CHANNEL_DISTORT_SEMITONES', '13'],
    ['CHANNEL_MAX_RECORDING_SECONDS', '0'],
    ['CHANNEL_MAX_INBOUND_CHARS', '0'],
    ['CHANNEL_VAULT_TTL_DAYS', '0'],
    ['CHANNEL_EVENT_TTL_HOURS', '0'],
    ['CHANNEL_AUDIO_TTL_MINUTES', '0'],
    ['CHANNEL_PURGE_INTERVAL_MS', '999'],
    ['CHANNEL_RELAY_INTERVAL_MS', '999'],
    ['CHANNEL_ACK_APPENDS', 'yes'],
    ['CHANNEL_INBOUND_PER_HASH_PER_HOUR', '0'],
    ['CHANNEL_NEW_CASES_PER_HASH_PER_DAY', '0'],
    ['CHANNEL_OUTBOUND_PER_CASE_PER_HOUR', '0'],
    ['CHANNEL_OUTBOUND_PER_HASH_PER_DAY', '0'],
    ['CHANNEL_OUTBOUND_PER_MINUTE', '0'],
    ['CHANNEL_OUTBOUND_MAX_ATTEMPTS', '0'],
    ['CHANNEL_ALLOW_STUB_INJECTION', 'yes'],
  ];
  for (const [key, value] of invalid) {
    assert.throws(() => parse({ [key]: value }), new RegExp(key));
  }
  assert.throws(
    () =>
      parse({
        CHANNEL_PROVIDER: 'telnyx',
        CHANNEL_PROCESSING_AGREEMENT: 'true',
        CHANNEL_ALLOW_STUB_INJECTION: 'true',
        CHANNEL_NUMBER_E164: '+385911234567',
        TELNYX_API_KEY: 'real-telnyx-key',
        TELNYX_PUBLIC_KEY: Buffer.alloc(32, 3).toString('base64'),
        TELNYX_MESSAGING_PROFILE_ID: 'profile-1',
        TELNYX_CONNECTION_ID: 'connection-1',
      }),
    /CHANNEL_ALLOW_STUB_INJECTION/,
  );
});

// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPublicKey } from 'node:crypto';

import { parseVaultKeys } from './crypto.js';

export type ChannelProvider = 'stub' | 'telnyx';
export type SttProvider = 'stub' | 'openai-compatible';
export type ChannelAudioSink = 'discard' | 'trace' | 'gateway';

export interface TelnyxConfig {
  numberE164: string;
  apiKey: string;
  publicKey: string;
  messagingProfileId: string;
  connectionId: string;
  ttsVoice: string;
  signatureToleranceSeconds: number;
}

export interface SttConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface ChannelConfig {
  internalApiToken: string;
  databaseUrl: string;
  traceInternalUrl: string;
  traceGatewayActorId: string;
  municipalityId: 'vrsar-orsera';
  deploymentProfile: 'dev' | 'pilot';
  channelProvider: ChannelProvider;
  sttProvider: SttProvider;
  processingAgreement: boolean;
  vaultKeys: Map<number, Buffer>;
  activeVaultKeyVersion: number;
  vaultPepper: string;
  auditInternalUrl: string;
  telnyx?: TelnyxConfig;
  stt?: SttConfig;
  audioSink: ChannelAudioSink;
  distortSemitones: number;
  maxRecordingSeconds: number;
  maxInboundChars: number;
  vaultTtlDays: number;
  eventTtlHours: number;
  audioTtlMinutes: number;
  purgeIntervalMs: number;
  relayIntervalMs: number;
  ackAppends: boolean;
  inboundPerHashPerHour: number;
  newCasesPerHashPerDay: number;
  outboundPerCasePerHour: number;
  outboundPerHashPerDay: number;
  outboundPerMinute: number;
  outboundMaxAttempts: number;
  allowStubInjection: boolean;
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function requiredSecret(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() !== value || value.length > 4_096 || hasControl(value)) {
    throw new Error(`${key} is required, bounded, and must not contain unsafe whitespace`);
  }
  return value;
}

function requiredValue(env: NodeJS.ProcessEnv, key: string, maximum = 4_096): string {
  const value = env[key];
  if (!value || value.trim() !== value || value.length > maximum || hasControl(value)) {
    throw new Error(`${key} is required and must be a safe bounded value`);
  }
  return value;
}

function parseDatabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a postgres:// URL with a database name');
  }
  if ((parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') || !parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    throw new Error('DATABASE_URL must be a postgres:// URL with a database name');
  }
  return raw;
}

function parseHttpUrl(raw: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${key} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${key} must be an absolute HTTP(S) URL`);
  }
  if (parsed.username || parsed.password) throw new Error(`${key} must not contain credentials`);
  return parsed.href;
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  let hostname: string | undefined;
  try {
    hostname = new URL(normalized).hostname;
  } catch {
    hostname = undefined;
  }
  return (
    normalized === 'stub' ||
    normalized === 'example.com' ||
    normalized.endsWith('.example') ||
    normalized.endsWith('.invalid') ||
    normalized.includes('placeholder') ||
    normalized.includes('change-me') ||
    hostname === 'example.com' ||
    hostname?.endsWith('.example') === true ||
    hostname?.endsWith('.invalid') === true
  );
}

function rejectPlaceholder(profile: 'dev' | 'pilot', key: string, value: string): void {
  if (profile !== 'dev' && isPlaceholder(value)) {
    throw new Error(`${key} must not contain a placeholder outside development`);
  }
}

function enumValue<T extends string>(
  raw: string | undefined,
  key: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const value = raw ?? fallback;
  if (!value || !allowed.includes(value as T)) {
    throw new Error(`${key} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function providerValue<T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  allowed: readonly T[],
  profile: 'dev' | 'pilot',
  fallback: T,
): T {
  if (profile === 'pilot' && env[key] === undefined) {
    throw new Error(`${key} is required when DEPLOYMENT_PROFILE=pilot`);
  }
  return enumValue(env[key], key, allowed, fallback);
}

function integerValue(
  raw: string | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function booleanValue(raw: string | undefined, key: string, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${key} must be exactly true or false`);
}

function parseTelnyxPublicKey(env: NodeJS.ProcessEnv): string {
  const raw = env.TELNYX_PUBLIC_KEY;
  if (!raw || raw.length > 8_192) throw new Error('TELNYX_PUBLIC_KEY is required and bounded');
  try {
    if (raw.trim().startsWith('-----BEGIN')) {
      createPublicKey(raw.trim());
      return raw.trim();
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) throw new Error();
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.byteLength !== 32 || decoded.toString('base64') !== raw) throw new Error();
    return raw;
  } catch {
    throw new Error('TELNYX_PUBLIC_KEY must be a base64 32-byte Ed25519 key or PEM');
  }
}

function parseDistortSemitones(raw: string | undefined): number {
  const value = raw === undefined ? -4 : Number(raw);
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 12) {
    throw new Error('CHANNEL_DISTORT_SEMITONES must be nonzero and within -12 to 12');
  }
  return value;
}

export function parseChannelConfig(env: NodeJS.ProcessEnv = process.env): ChannelConfig {
  const deploymentProfile = enumValue(
    env.DEPLOYMENT_PROFILE,
    'DEPLOYMENT_PROFILE',
    ['dev', 'pilot'] as const,
    'dev',
  );
  const internalApiToken = requiredSecret(env, 'INTERNAL_API_TOKEN');
  const databaseUrl = parseDatabaseUrl(requiredSecret(env, 'DATABASE_URL'));
  const traceInternalUrl = parseHttpUrl(requiredValue(env, 'TRACE_INTERNAL_URL'), 'TRACE_INTERNAL_URL');
  const traceGatewayActorId = requiredValue(env, 'TRACE_GATEWAY_ACTOR_ID', 64);
  if (!/^[a-z0-9-]{3,64}$/.test(traceGatewayActorId)) {
    throw new Error('TRACE_GATEWAY_ACTOR_ID must match /^[a-z0-9-]{3,64}$/');
  }
  if (env.CHANNEL_MUNICIPALITY_ID !== 'vrsar-orsera') {
    throw new Error('CHANNEL_MUNICIPALITY_ID must be vrsar-orsera');
  }
  const channelProvider = providerValue(
    env,
    'CHANNEL_PROVIDER',
    ['stub', 'telnyx'] as const,
    deploymentProfile,
    'stub',
  );
  const sttProvider = providerValue(
    env,
    'STT_PROVIDER',
    ['stub', 'openai-compatible'] as const,
    deploymentProfile,
    'stub',
  );
  const processingAgreement = booleanValue(
    env.CHANNEL_PROCESSING_AGREEMENT,
    'CHANNEL_PROCESSING_AGREEMENT',
    false,
  );
  if ((channelProvider !== 'stub' || sttProvider !== 'stub') && !processingAgreement) {
    throw new Error('CHANNEL_PROCESSING_AGREEMENT must be exactly true for non-stub providers');
  }

  const rawVaultKeys = requiredSecret(env, 'PHONE_VAULT_KEY');
  const vaultKeys = parseVaultKeys(rawVaultKeys);
  const activeVaultKeyVersion = Math.max(...vaultKeys.keys());
  const vaultPepper = requiredSecret(env, 'PHONE_VAULT_PEPPER');
  if (vaultPepper.length < 32) throw new Error('PHONE_VAULT_PEPPER must be at least 32 characters');
  const encodedVaultKeys = rawVaultKeys.split(',').map((entry) => entry.slice(entry.indexOf(':') + 1));
  if (
    encodedVaultKeys.includes(vaultPepper) ||
    [...vaultKeys.values()].some((key) => key.equals(Buffer.from(vaultPepper, 'utf8')))
  ) {
    throw new Error('PHONE_VAULT_PEPPER must differ from every PHONE_VAULT_KEY');
  }

  let telnyx: TelnyxConfig | undefined;
  if (channelProvider === 'telnyx') {
    const numberE164 = requiredValue(env, 'CHANNEL_NUMBER_E164', 16);
    if (!/^\+[1-9]\d{7,14}$/.test(numberE164)) {
      throw new Error('CHANNEL_NUMBER_E164 must be valid E.164');
    }
    const apiKey = requiredSecret(env, 'TELNYX_API_KEY');
    const publicKey = parseTelnyxPublicKey(env);
    const messagingProfileId = requiredValue(env, 'TELNYX_MESSAGING_PROFILE_ID');
    const connectionId = requiredValue(env, 'TELNYX_CONNECTION_ID');
    const ttsVoice = env.TELNYX_TTS_VOICE ?? 'Azure.hr-HR-GabrijelaNeural';
    if (!/^(Azure\.hr-HR-|ElevenLabs\.)/.test(ttsVoice)) {
      throw new Error('TELNYX_TTS_VOICE must start with Azure.hr-HR- or ElevenLabs.');
    }
    for (const [key, value] of [
      ['TELNYX_API_KEY', apiKey],
      ['TELNYX_PUBLIC_KEY', publicKey],
      ['TELNYX_MESSAGING_PROFILE_ID', messagingProfileId],
      ['TELNYX_CONNECTION_ID', connectionId],
    ] as const) {
      rejectPlaceholder(deploymentProfile, key, value);
    }
    telnyx = {
      numberE164,
      apiKey,
      publicKey,
      messagingProfileId,
      connectionId,
      ttsVoice,
      signatureToleranceSeconds: integerValue(
        env.TELNYX_SIGNATURE_TOLERANCE_S,
        'TELNYX_SIGNATURE_TOLERANCE_S',
        300,
        30,
        900,
      ),
    };
  }

  let stt: SttConfig | undefined;
  if (sttProvider === 'openai-compatible') {
    const baseUrl = parseHttpUrl(requiredValue(env, 'STT_BASE_URL'), 'STT_BASE_URL');
    if (new URL(baseUrl).protocol !== 'https:' && !isLoopback(baseUrl)) {
      throw new Error('STT_BASE_URL must use HTTPS unless it is loopback');
    }
    const apiKey = requiredSecret(env, 'STT_API_KEY');
    const model = requiredValue(env, 'STT_MODEL');
    rejectPlaceholder(deploymentProfile, 'STT_BASE_URL', baseUrl);
    rejectPlaceholder(deploymentProfile, 'STT_API_KEY', apiKey);
    rejectPlaceholder(deploymentProfile, 'STT_MODEL', model);
    stt = {
      baseUrl,
      apiKey,
      model,
      timeoutMs: integerValue(env.STT_TIMEOUT_MS, 'STT_TIMEOUT_MS', 30_000, 1_000, 120_000),
      maxBytes: integerValue(env.STT_MAX_BYTES, 'STT_MAX_BYTES', 10_000_000, 1, 100_000_000),
    };
  }

  const allowStubInjection = booleanValue(
    env.CHANNEL_ALLOW_STUB_INJECTION,
    'CHANNEL_ALLOW_STUB_INJECTION',
    false,
  );
  if (allowStubInjection && channelProvider !== 'stub') {
    throw new Error('CHANNEL_ALLOW_STUB_INJECTION=true requires CHANNEL_PROVIDER=stub');
  }

  return {
    internalApiToken,
    databaseUrl,
    traceInternalUrl,
    traceGatewayActorId,
    municipalityId: 'vrsar-orsera',
    deploymentProfile,
    channelProvider,
    sttProvider,
    processingAgreement,
    vaultKeys,
    activeVaultKeyVersion,
    vaultPepper,
    auditInternalUrl: parseHttpUrl(
      env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600',
      'AUDIT_INTERNAL_URL',
    ),
    ...(telnyx ? { telnyx } : {}),
    ...(stt ? { stt } : {}),
    audioSink: enumValue(
      env.CHANNEL_AUDIO_SINK,
      'CHANNEL_AUDIO_SINK',
      ['discard', 'trace', 'gateway'] as const,
      'discard',
    ),
    distortSemitones: parseDistortSemitones(env.CHANNEL_DISTORT_SEMITONES),
    maxRecordingSeconds: integerValue(
      env.CHANNEL_MAX_RECORDING_SECONDS,
      'CHANNEL_MAX_RECORDING_SECONDS',
      180,
      1,
      600,
    ),
    maxInboundChars: integerValue(
      env.CHANNEL_MAX_INBOUND_CHARS,
      'CHANNEL_MAX_INBOUND_CHARS',
      1_600,
      1,
      10_000,
    ),
    vaultTtlDays: integerValue(env.CHANNEL_VAULT_TTL_DAYS, 'CHANNEL_VAULT_TTL_DAYS', 180, 1, 3_650),
    eventTtlHours: integerValue(env.CHANNEL_EVENT_TTL_HOURS, 'CHANNEL_EVENT_TTL_HOURS', 168, 1, 8_760),
    audioTtlMinutes: integerValue(
      env.CHANNEL_AUDIO_TTL_MINUTES,
      'CHANNEL_AUDIO_TTL_MINUTES',
      60,
      1,
      1_440,
    ),
    purgeIntervalMs: integerValue(
      env.CHANNEL_PURGE_INTERVAL_MS,
      'CHANNEL_PURGE_INTERVAL_MS',
      3_600_000,
      1_000,
      86_400_000,
    ),
    relayIntervalMs: integerValue(
      env.CHANNEL_RELAY_INTERVAL_MS,
      'CHANNEL_RELAY_INTERVAL_MS',
      15_000,
      1_000,
      300_000,
    ),
    ackAppends: booleanValue(env.CHANNEL_ACK_APPENDS, 'CHANNEL_ACK_APPENDS', false),
    inboundPerHashPerHour: integerValue(
      env.CHANNEL_INBOUND_PER_HASH_PER_HOUR,
      'CHANNEL_INBOUND_PER_HASH_PER_HOUR',
      20,
      1,
      100_000,
    ),
    newCasesPerHashPerDay: integerValue(
      env.CHANNEL_NEW_CASES_PER_HASH_PER_DAY,
      'CHANNEL_NEW_CASES_PER_HASH_PER_DAY',
      5,
      1,
      100_000,
    ),
    outboundPerCasePerHour: integerValue(
      env.CHANNEL_OUTBOUND_PER_CASE_PER_HOUR,
      'CHANNEL_OUTBOUND_PER_CASE_PER_HOUR',
      5,
      1,
      100_000,
    ),
    outboundPerHashPerDay: integerValue(
      env.CHANNEL_OUTBOUND_PER_HASH_PER_DAY,
      'CHANNEL_OUTBOUND_PER_HASH_PER_DAY',
      20,
      1,
      100_000,
    ),
    outboundPerMinute: integerValue(
      env.CHANNEL_OUTBOUND_PER_MINUTE,
      'CHANNEL_OUTBOUND_PER_MINUTE',
      30,
      1,
      100_000,
    ),
    outboundMaxAttempts: integerValue(
      env.CHANNEL_OUTBOUND_MAX_ATTEMPTS,
      'CHANNEL_OUTBOUND_MAX_ATTEMPTS',
      3,
      1,
      20,
    ),
    allowStubInjection,
  };
}

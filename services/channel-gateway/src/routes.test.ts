// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { BodyTooLargeError, readBody, type Route } from '@polis/service-runtime';
import type { ChannelConfig } from './config.js';
import { MemoryChannelStore } from './memory-store.js';
import type { PipelineDeps } from './pipeline-types.js';
import { channelRoutes } from './routes.js';
import { createStubSttProvider } from './stub-stt.js';
import { StubChannelProvider } from './stub-provider.js';

const key = Buffer.alloc(32, 7);
const phone = ['+385', '91', '111', '1111'].join('');
const webhookSecret = 'a-real-webhook-secret-at-least-32-characters';

function assertRouteResult(value: unknown, status: number, body: unknown): void {
  if (value === null || typeof value !== 'object' || !('status' in value) || !('body' in value)) {
    assert.fail('route did not return an HTTP result');
  }
  assert.equal(value.status, status);
  assert.deepEqual(value.body, body);
}

function baseConfig(allowStubInjection = false): ChannelConfig {
  return {
    internalApiToken: 'token',
    databaseUrl: 'postgres://localhost/polis',
    traceInternalUrl: 'http://trace.internal/',
    traceGatewayActorId: 'trace-gateway',
    municipalityId: 'vrsar-orsera',
    deploymentProfile: 'dev',
    channelProvider: 'stub',
    sttProvider: 'stub',
    processingAgreement: false,
    vaultKeys: new Map([[1, key]]),
    activeVaultKeyVersion: 1,
    vaultPepper: 'x'.repeat(32),
    auditInternalUrl: 'http://audit.internal/',
    infobip: {
      baseUrl: 'https://account.api.infobip.com/',
      apiKey: 'key',
      webhookSecret,
      webhookSignatureHeader: 'x-hub-signature',
      sender: '+385981234567',
      callsConfigurationId: 'calls-1',
      ttsLanguage: 'hr',
    },
    audioSink: 'discard',
    distortSemitones: -4,
    maxRecordingSeconds: 180,
    maxInboundChars: 1600,
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
    allowStubInjection,
  };
}

function deps(
  store: MemoryChannelStore,
  allowStubInjection = false,
  provider: PipelineDeps['provider'] = new StubChannelProvider(),
): PipelineDeps {
  return {
    config: baseConfig(allowStubInjection),
    store,
    provider,
    trace: {
      async createChannelCase() {
        return {
          case: { recordId: 'rec-1', caseNumber: 'VRS-1', reopenKey: 'rk', state: 'open' },
        };
      },
      async appendChannelMessage() {
        return { message: { id: 'msg-1' } };
      },
      async listOutbox() {
        return { messages: [] };
      },
      async markDelivery() {},
    },
    audit: { async emit() {} },
    log() {},
    now: () => new Date('2027-01-15T08:00:00.000Z'),
    stt: createStubSttProvider(),
  };
}

function route(path: string, subject: PipelineDeps): Route {
  const found = channelRoutes(subject).find((entry) => entry.path === path);
  assert.ok(found);
  return found;
}

function signedHeaders(raw: Uint8Array): Record<string, string> {
  return {
    'x-hub-signature': `sha256=${createHmac('sha256', webhookSecret).update(raw).digest('hex')}`,
  };
}

function smsBody(id = 'message-1'): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      results: [
        {
          messageId: id,
          from: phone,
          to: '+385981234567',
          text: 'Rupa u cesti',
          receivedAt: '2027-01-15T08:00:00.000Z',
        },
      ],
      messageCount: 1,
      pendingMessageCount: 0,
    }),
  );
}

function callBody(type: string, id?: string): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      ...(id ? { id } : {}),
      callId: 'call-1',
      type,
      timestamp: '2027-01-15T08:00:00.000Z',
      properties: {
        call: {
          id: 'call-1',
          direction: 'INBOUND',
          from: phone,
          to: '+385981234567',
          state: 'RINGING',
          customData: {},
        },
      },
    }),
  );
}

const request = (headers: Record<string, string> = {}): IncomingMessage =>
  ({ headers }) as IncomingMessage;

test('smoke mount exposes operational routes and stub injection only when enabled', () => {
  assert.deepEqual(
    channelRoutes({}).map((entry) => entry.path),
    ['/healthz', '/readyz', '/metrics', '/version'],
  );
  const hidden = channelRoutes(deps(new MemoryChannelStore())).map((entry) => entry.path);
  assert.equal(hidden.includes('/internal/channel/stub/inbound-sms'), false);
  const enabled = channelRoutes(deps(new MemoryChannelStore(), true)).map((entry) => entry.path);
  assert.ok(enabled.includes('/internal/channel/stub/inbound-sms'));
  assert.ok(enabled.includes('/internal/channel/stub/inbound-call'));
});

test('three Infobip routes preserve raw bodies and enforce the 64 KiB cap', async () => {
  const subject = deps(new MemoryChannelStore());
  for (const path of [
    '/internal/channel/webhooks/infobip/sms',
    '/internal/channel/webhooks/infobip/sms-reports',
    '/internal/channel/webhooks/infobip/calls',
  ]) {
    const webhook = route(path, subject);
    assert.equal(webhook.bodyMode, 'raw');
    assert.equal(webhook.maxBodyBytes, 65_536);
  }
  const stream = new PassThrough() as PassThrough & IncomingMessage;
  stream.end(Buffer.alloc(65_537));
  await assert.rejects(
    readBody(stream, 'raw', 65_536),
    (error) => error instanceof BodyTooLargeError,
  );
});

test('SMS webhook verifies HMAC and dedupes each accepted provider event', async () => {
  const subject = deps(new MemoryChannelStore());
  const webhook = route('/internal/channel/webhooks/infobip/sms', subject);
  const raw = smsBody();
  assertRouteResult(await webhook.handler(request(), raw, {}), 401, {
    error: 'invalid_signature',
  });
  assertRouteResult(await webhook.handler(request(signedHeaders(raw)), raw, {}), 202, {
    accepted: true,
    duplicate: false,
  });
  assertRouteResult(await webhook.handler(request(signedHeaders(raw)), raw, {}), 202, {
    accepted: true,
    duplicate: true,
  });
});

test('calls webhook verifies HMAC, hashes fallback event IDs, and queues handling', async () => {
  const subject = deps(new MemoryChannelStore());
  const webhook = route('/internal/channel/webhooks/infobip/calls', subject);
  const raw = callBody('CALL_RECEIVED');
  assertRouteResult(await webhook.handler(request(signedHeaders(raw)), raw, {}), 202, {
    accepted: true,
    duplicate: false,
  });
  assertRouteResult(await webhook.handler(request(signedHeaders(raw)), raw, {}), 202, {
    accepted: true,
    duplicate: true,
  });
});

test('stub SMS and call routes return redacted deterministic outputs', async () => {
  const provider = new StubChannelProvider();
  const subject = deps(new MemoryChannelStore(), true, provider);
  const sms = await route('/internal/channel/stub/inbound-sms', subject).handler(
    request(),
    { from: phone, text: 'Rupa u cesti' },
    {},
  );
  assert.ok(sms && typeof sms === 'object' && 'caseNumber' in sms);
  assert.equal(sms.caseNumber, 'VRS-1');

  const call = await route('/internal/channel/stub/inbound-call', subject).handler(
    request(),
    { from: phone },
    {},
  );
  const value = call as {
    caseNumber: string;
    recordId: string;
    sentMessages: Array<{ to: string; text: string; idempotencyKey: string }>;
    commands: string[];
  };
  assert.equal(value.caseNumber, 'VRS-1');
  assert.equal(value.recordId, 'rec-1');
  assert.equal(value.sentMessages[0]?.to, '[redacted]');
  assert.equal(value.sentMessages[0]?.text.includes('VRS-1'), true);
  assert.equal(
    value.commands.some((command) => command.startsWith('answer:')),
    true,
  );
  assert.equal(
    value.commands.some((command) => command.startsWith('record_start:')),
    true,
  );
  assert.equal(
    value.commands.some((command) => command.startsWith('delete_recording:')),
    true,
  );
  assert.equal(JSON.stringify(value).includes(phone), false);
});

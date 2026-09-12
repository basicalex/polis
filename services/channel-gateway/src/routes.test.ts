// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
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
import type { EventState } from './types.js';

const key = Buffer.alloc(32, 7);
const phone = ['+385', '91', '111', '1111'].join('');

function assertRouteResult(value: unknown, status: number, body: unknown): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('status' in value) ||
    !('body' in value)
  ) {
    assert.fail('route did not return an HTTP result');
  }
  assert.equal(value.status, status);
  assert.deepEqual(value.body, body);
}


function baseConfig(publicKey: string, allowStubInjection = false): ChannelConfig {
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
    telnyx: {
      numberE164: phone,
      apiKey: 'telnyx-key',
      publicKey,
      messagingProfileId: 'profile',
      connectionId: 'connection',
      ttsVoice: 'Azure.hr-HR-GabrijelaNeural',
      signatureToleranceSeconds: 300,
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

class RouteStore extends MemoryChannelStore {
  calls = 0;

  constructor(private readonly duplicate = false) {
    super();
  }

  override async recordEvent(
    _provider: string,
    _eventId: string,
    _eventType: string,
    _payloadSha256: string,
  ): Promise<{ duplicate: boolean }> {
    this.calls += 1;
    return { duplicate: this.duplicate };
  }

  override async markEvent(
    _provider: string,
    _eventId: string,
    _state: EventState,
    _lastError?: string | null,
  ): Promise<void> {}
}

function signedHeaders(
  raw: Uint8Array,
  privateKeyPem: string,
  timestamp = '1800000000',
): Record<string, string> {
  const privateKey = createPrivateKey(privateKeyPem);
  return {
    'telnyx-timestamp': timestamp,
    'telnyx-signature-ed25519': sign(
      null,
      Buffer.concat([Buffer.from(timestamp), Buffer.from('|'), Buffer.from(raw)]),
      privateKey,
    ).toString('base64'),
  };
}

function signedDeps(
  store: MemoryChannelStore,
  allowStubInjection = false,
  provider: PipelineDeps['provider'] = new StubChannelProvider(),
): { deps: PipelineDeps; privateKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKey = publicDer.subarray(-32).toString('base64');
  const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  return {
    privateKey,
    deps: {
      config: baseConfig(publicKey, allowStubInjection),
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
      now: () => new Date(Number('1800000000') * 1000),
      stt: createStubSttProvider(),
    },
  };
}

function route(path: string, deps: PipelineDeps): Route {
  const found = channelRoutes(deps).find((entry) => entry.path === path);
  assert.ok(found);
  return found;
}

function envelope(
  eventType: string,
  id = 'evt-1',
  payload: Record<string, unknown> = {},
): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      data: {
        id,
        event_type: eventType,
        occurred_at: '2027-01-15T08:00:00.000Z',
        record_type: 'event',
        payload,
      },
    }),
  );
}

const request = (headers: Record<string, string> = {}): IncomingMessage =>
  ({ headers } as IncomingMessage);

test('smoke mount returns only operational routes and stub routes are conditional', () => {
  assert.deepEqual(channelRoutes({}).map((entry) => entry.path), [
    '/healthz',
    '/readyz',
    '/metrics',
    '/version',
  ]);
  const { deps } = signedDeps(new RouteStore(), false);
  const routes = channelRoutes(deps);
  assert.equal(routes.some((entry) => entry.path.startsWith('/internal/channel/stub/')), false);
  const enabled = channelRoutes({
    ...deps,
    config: { ...deps.config, allowStubInjection: true },
  });
  assert.equal(enabled.some((entry) => entry.path === '/internal/channel/stub/inbound-sms'), true);
  assert.equal(enabled.some((entry) => entry.path === '/internal/channel/stub/inbound-call'), true);
});

test('webhook routes use raw 64 KiB bodies and reject oversized input with 413', async () => {
  const { deps } = signedDeps(new RouteStore());
  for (const path of [
    '/internal/channel/webhooks/telnyx/messaging',
    '/internal/channel/webhooks/telnyx/voice',
  ]) {
    const webhook = route(path, deps);
    assert.equal(webhook.bodyMode, 'raw');
    assert.equal(webhook.maxBodyBytes, 65_536);
    const stream = new PassThrough();
    stream.end(Buffer.alloc(65_537));
    await assert.rejects(
      readBody(stream as unknown as IncomingMessage, webhook.bodyMode, webhook.maxBodyBytes),
      (error: unknown) => error instanceof BodyTooLargeError && error.status === 413,
    );
  }
});

test('messaging webhook returns 401, 400, 202, and duplicate shapes', async () => {
  const { deps, privateKey } = signedDeps(new RouteStore());
  const messaging = route('/internal/channel/webhooks/telnyx/messaging', deps);
  const incoming = envelope('message.received', 'evt-message', {
    from: { phone_number: phone },
    text: 'Rupa u cesti',
  });
  const unauthorized = await messaging.handler(request(), incoming, {});
  assertRouteResult(unauthorized, 401, { error: 'invalid_signature' });

  const invalid = Buffer.from('{"data":{}}');
  const malformed = await messaging.handler(
    request(signedHeaders(invalid, privateKey)),
    invalid,
    {},
  );
  assertRouteResult(malformed, 400, { error: 'invalid_event' });

  const accepted = await messaging.handler(
    request(signedHeaders(incoming, privateKey)),
    incoming,
    {},
  );
  assertRouteResult(accepted, 202, { accepted: true, duplicate: false });

  const duplicateFixture = signedDeps(new RouteStore(true));
  const duplicateRaw = envelope('message.received', 'evt-duplicate', {
    from: { phone_number: phone },
    text: 'Rupa u cesti',
  });
  const duplicate = await route(
    '/internal/channel/webhooks/telnyx/messaging',
    duplicateFixture.deps,
  ).handler(
    request(signedHeaders(duplicateRaw, duplicateFixture.privateKey)),
    duplicateRaw,
    {},
  );
  assertRouteResult(duplicate, 202, { accepted: true, duplicate: true });
});

test('voice webhook verifies and validates before fast acceptance', async () => {
  const { deps, privateKey } = signedDeps(new RouteStore());
  const voice = route('/internal/channel/webhooks/telnyx/voice', deps);
  const raw = envelope('call.initiated', 'evt-voice', {
    direction: 'incoming',
    from: phone,
    call_control_id: 'call-1',
  });
  assertRouteResult(await voice.handler(request(), raw, {}), 401, {
    error: 'invalid_signature',
  });
  const invalid = Buffer.from('{"data":{}}');
  assertRouteResult(
    await voice.handler(request(signedHeaders(invalid, privateKey)), invalid, {}),
    400,
    { error: 'invalid_event' },
  );
  assertRouteResult(
    await voice.handler(request(signedHeaders(raw, privateKey)), raw, {}),
    202,
    { accepted: true, duplicate: false },
  );
});

test('stub SMS injection returns the exact redacted response after synchronous delivery', async () => {
  const provider = new StubChannelProvider();
  const { deps } = signedDeps(new MemoryChannelStore(), true, provider);
  const response = await route('/internal/channel/stub/inbound-sms', deps).handler(
    request(),
    { from: phone, text: 'Rupa u cesti' },
    {},
  );
  const value = response as {
    caseNumber: string | null;
    recordId: string | null;
    sentMessages: Array<{ to: string; text: string; idempotencyKey: string }>;
    commands: string[];
  };
  assert.deepEqual(Object.keys(value), ['caseNumber', 'recordId', 'sentMessages', 'commands']);
  assert.equal(value.caseNumber, 'VRS-1');
  assert.equal(value.recordId, 'rec-1');
  assert.equal(value.sentMessages.length, 1);
  assert.equal(value.sentMessages[0]?.to, '[redacted]');
  assert.equal(value.sentMessages[0]?.text, 'Prijava je zaprimljena. Broj predmeta: VRS-1.');
  assert.equal(JSON.stringify(value).includes(phone), false);
});

test('stub call injection drives call control, recording, transcript, and confirmation', async () => {
  const provider = new StubChannelProvider();
  const { deps } = signedDeps(new MemoryChannelStore(), true, provider);
  const response = await route('/internal/channel/stub/inbound-call', deps).handler(
    request(),
    { from: phone },
    {},
  );
  const value = response as {
    caseNumber: string | null;
    recordId: string | null;
    sentMessages: Array<{ to: string; text: string; idempotencyKey: string }>;
    commands: string[];
  };
  assert.equal(value.caseNumber, 'VRS-1');
  assert.equal(value.recordId, 'rec-1');
  assert.equal(value.sentMessages[0]?.to, '[redacted]');
  assert.equal(value.sentMessages[0]?.text.includes('VRS-1'), true);
  assert.equal(value.commands.some((command) => command.startsWith('answer:')), true);
  assert.equal(value.commands.some((command) => command.startsWith('record_start:')), true);
  assert.equal(value.commands.some((command) => command.startsWith('delete_recording:')), true);
  assert.equal(JSON.stringify(value).includes(phone), false);
});

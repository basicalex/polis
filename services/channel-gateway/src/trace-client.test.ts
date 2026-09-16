// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChannelConfig } from './config.js';
import { createTraceClient, idempotencyUuid, TraceClientError } from './trace-client.js';
import type { FetchImplementation } from './infobip-client.js';

function config(): ChannelConfig {
  return {
    internalApiToken: 'token',
    databaseUrl: 'postgres://u:p@localhost/db',
    traceInternalUrl: 'http://trace.local/base/',
    traceGatewayActorId: 'channel-gateway',
    municipalityId: 'vrsar-orsera',
    deploymentProfile: 'dev',
    channelProvider: 'stub',
    sttProvider: 'stub',
    processingAgreement: false,
    vaultKeys: new Map([[1, Buffer.alloc(32, 1)]]),
    activeVaultKeyVersion: 1,
    vaultPepper: 'x'.repeat(32),
    auditInternalUrl: 'http://audit.local',
    audioSink: 'discard',
    distortSemitones: -4,
    maxRecordingSeconds: 60,
    maxInboundChars: 1000,
    vaultTtlDays: 30,
    appendWindowHours: 72,
    closedRetentionDays: 30,
    eventTtlHours: 24,
    audioTtlMinutes: 10,
    purgeIntervalMs: 60000,
    relayIntervalMs: 60000,
    ackAppends: true,
    inboundPerHashPerHour: 10,
    newCasesPerHashPerDay: 3,
    outboundPerCasePerHour: 10,
    outboundPerHashPerDay: 20,
    outboundPerMinute: 30,
    outboundMaxAttempts: 3,
    allowStubInjection: true,
  };
}

test('createChannelCase posts trace wire payload, headers, and timeout-safe body', async () => {
  process.env.INTERNAL_API_TOKEN = 'internal-token';
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchImplementation = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json(
      { case: { recordId: 'rec-1', caseNumber: 'VRS-1', reopenKey: 'rk', state: 'open' } },
      { status: 201 },
    );
  };
  const client = createTraceClient(config(), fetchImpl);

  const result = await client.createChannelCase(
    { channel: 'sms', text: 'Tekst', source: 'typed', occurredAt: '2026-09-12T00:00:00.000Z' },
    'inbox-1',
  );

  assert.equal(result.case.caseNumber, 'VRS-1');
  assert.equal(calls[0]?.url, 'http://trace.local/base/internal/trace/channel/cases');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers['x-polis-internal-token'], 'internal-token');
  assert.equal(headers['x-polis-trace-gateway'], 'channel-gateway');
  assert.equal(headers['idempotency-key'], idempotencyUuid('inbox-1'));
  assert.equal(calls[0]?.init.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    channel: 'sms',
    text: 'Tekst',
    source: 'typed',
    occurredAt: '2026-09-12T00:00:00.000Z',
  });
});

test('appendChannelMessage uses text field and delivery ack uses failureCode', async () => {
  process.env.INTERNAL_API_TOKEN = 'internal-token';
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: FetchImplementation = async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(input).endsWith('/messages'))
      return Response.json({ message: { id: 'message-1' } }, { status: 201 });
    return Response.json({ message: { id: 'outbox-1' } }, { status: 200 });
  };
  const client = createTraceClient(config(), fetchImpl);

  await client.appendChannelMessage(
    'VRS-1',
    {
      reopenKey: 'rk',
      channel: 'sms',
      kind: 'append',
      text: 'Nastavak',
      source: 'typed',
      occurredAt: '2026-09-12T00:00:00.000Z',
    },
    'append-1',
  );
  await client.markDelivery('out-1', { state: 'failed', failureCode: 'blocked' }, 'delivery-1');

  assert.equal(
    calls[0]?.url,
    'http://trace.local/base/internal/trace/channel/cases/VRS-1/messages',
  );
  assert.deepEqual(calls[0]?.body, {
    reopenKey: 'rk',
    channel: 'sms',
    kind: 'append',
    text: 'Nastavak',
    source: 'typed',
    occurredAt: '2026-09-12T00:00:00.000Z',
  });
  assert.equal(Object.hasOwn(calls[0]?.body as object, 'body'), false);
  assert.equal(
    calls[1]?.url,
    'http://trace.local/base/internal/trace/channel/outbox/out-1/delivery',
  );
  assert.deepEqual(calls[1]?.body, { state: 'failed', failureCode: 'blocked' });
});

test('listOutbox validates trace messages and authenticates the poll', async () => {
  process.env.INTERNAL_API_TOKEN = 'internal-token';
  const client = createTraceClient(config(), async (input, init) => {
    assert.equal(String(input), 'http://trace.local/base/internal/trace/channel/outbox?limit=50');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['x-polis-trace-gateway'], 'channel-gateway');
    assert.equal(headers['idempotency-key'], idempotencyUuid('list-outbox:50'));
    return Response.json({
      messages: [
        {
          id: 'm1',
          recordId: 'r1',
          kind: 'sms',
          body: 'Tekst',
          createdAt: '2026-09-12T00:00:00.000Z',
        },
      ],
    });
  });

  assert.deepEqual(await client.listOutbox(50), {
    messages: [
      {
        id: 'm1',
        recordId: 'r1',
        kind: 'sms',
        body: 'Tekst',
        createdAt: '2026-09-12T00:00:00.000Z',
      },
    ],
  });
});

test('readCaseClosure parses terminal timestamps without an idempotency header', async () => {
  process.env.INTERNAL_API_TOKEN = 'internal-token';
  const cases = [
    {
      caseNumber: 'VRS/1',
      response: {
        case: {
          state: 'resolved',
          updatedAt: '2026-09-12T05:00:00.000Z',
        },
        record: { resolvedAt: '2026-09-12T04:00:00.000Z', events: [] },
      },
      expected: { state: 'resolved', terminalAt: '2026-09-12T04:00:00.000Z' },
    },
    {
      caseNumber: 'VRS-2',
      response: {
        case: { state: 'closed', updatedAt: '2026-09-12T06:00:00.000Z' },
        record: null,
      },
      expected: { state: 'closed', terminalAt: '2026-09-12T06:00:00.000Z' },
    },
    {
      caseNumber: 'VRS-3',
      response: {
        case: { state: 'closed', updatedAt: '2026-09-12T07:00:00.000Z' },
        record: {
          events: [
            { action: 'case-closed', createdAt: '2026-09-12T01:00:00.000Z' },
            { action: 'case-reopened', createdAt: '2026-09-12T02:00:00.000Z' },
            { action: 'case-closed', createdAt: '2026-09-12T03:00:00.000Z' },
          ],
        },
      },
      expected: { state: 'closed', terminalAt: '2026-09-12T03:00:00.000Z' },
    },
    {
      caseNumber: 'VRS-4',
      response: {
        case: {
          state: 'resolved',
          terminalAt: '2026-09-12T01:00:00.000Z',
          updatedAt: '2026-09-12T09:00:00.000Z',
        },
        record: { resolvedAt: '2026-09-12T08:00:00.000Z', events: [] },
      },
      expected: { state: 'resolved', terminalAt: '2026-09-12T01:00:00.000Z' },
    },
    {
      caseNumber: 'VRS-5',
      response: {
        case: { state: 'answered', updatedAt: '2026-09-12T10:00:00.000Z' },
        record: { resolvedAt: null, events: [] },
      },
      expected: { state: 'answered', terminalAt: null },
    },
  ] as const;

  for (const entry of cases) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createTraceClient(config(), async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return Response.json(entry.response);
    });

    assert.deepEqual(await client.readCaseClosure(entry.caseNumber), entry.expected);
    assert.equal(
      calls[0]?.url,
      `http://trace.local/base/internal/trace/public/cases/${encodeURIComponent(entry.caseNumber)}`,
    );
    assert.equal(calls[0]?.init.method, 'GET');
    assert.equal(calls[0]?.init.body, undefined);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(Object.hasOwn(headers, 'idempotency-key'), false);
  }
});

test('readCaseClosure maps 404 to null and preserves other trace errors', async () => {
  process.env.INTERNAL_API_TOKEN = 'internal-token';
  const notFound = createTraceClient(config(), async () =>
    Response.json({ error: 'not_found' }, { status: 404 }),
  );
  const failed = createTraceClient(config(), async () =>
    Response.json({ error: 'internal_error' }, { status: 500 }),
  );

  assert.equal(await notFound.readCaseClosure('VRS-404'), null);
  await assert.rejects(
    failed.readCaseClosure('VRS-500'),
    (error) => error instanceof TraceClientError && error.status === 500,
  );
});

test('trace errors carry status and retryability', async () => {
  process.env.INTERNAL_API_TOKEN = 'internal-token';
  const client = createTraceClient(config(), async () =>
    Response.json({ error: 'too_many_attempts' }, { status: 429 }),
  );

  await assert.rejects(
    client.listOutbox(50),
    (error) =>
      error instanceof TraceClientError &&
      error.code === 'too_many_attempts' &&
      error.status === 429 &&
      error.retryable,
  );
});

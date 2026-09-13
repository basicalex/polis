// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { ChannelProviderError } from './channel-provider.js';
import { InfobipClient, type FetchImplementation } from './infobip-client.js';

const config = {
  baseUrl: 'https://account.api.infobip.com/',
  apiKey: 'key-1',
  webhookSecret: 'a-real-webhook-secret-at-least-32-characters',
  webhookSignatureHeader: 'x-hub-signature',
  sender: '+385911111111',
  callsConfigurationId: 'calls-1',
  ttsLanguage: 'hr',
};

test('sendSms posts Infobip message shape with App auth and destination idempotency', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchImplementation = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ messages: [{ messageId: 'msg-1' }] });
  };
  const client = new InfobipClient({ config, fetch: fetchImpl });

  assert.deepEqual(
    await client.sendSms({ to: '+385921111111', text: 'Poruka', idempotencyKey: 'idem-1' }),
    { providerMessageId: 'msg-1' },
  );
  assert.equal(calls[0]?.url, 'https://account.api.infobip.com/sms/2/text/advanced');
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, 'App key-1');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key'], undefined);
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    messages: [
      {
        from: '+385911111111',
        destinations: [{ to: '+385921111111', messageId: 'idem-1' }],
        text: 'Poruka',
      },
    ],
  });
});

test('call and recording methods use exact Infobip paths and bodies', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const client = new InfobipClient({
    config,
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (String(input).endsWith('/recordings/calls/call-1')) {
        return Response.json({ files: [{ fileId: 'file-1', durationSeconds: 3 }] });
      }
      if (String(input).endsWith('/transcription')) return Response.json({ text: 'tekst' });
      return new Response(null, { status: 204 });
    },
  });

  await client.answerCall('call-1');
  await client.speak('call-1', { text: 'Dobar dan', language: 'hr', voice: 'Ivana' });
  await client.recordStart('call-1', { maxLengthSeconds: 60, transcription: true });
  await client.stopRecording('call-1');
  await client.hangup('call-1');
  assert.deepEqual(await client.listRecordings('call-1'), [
    { fileId: 'file-1', durationSeconds: 3 },
  ]);
  await client.deleteRecording('file-1');
  assert.deepEqual(await client.fetchTranscription('file-1'), { text: 'tekst' });

  assert.deepEqual(
    calls.map(({ url, method, body }) => ({ url: new URL(url).pathname, method, body })),
    [
      { url: '/calls/1/calls/call-1/answer', method: 'POST', body: null },
      {
        url: '/calls/1/calls/call-1/say',
        method: 'POST',
        body: { text: 'Dobar dan', language: 'hr', voice: { name: 'Ivana' } },
      },
      {
        url: '/calls/1/calls/call-1/start-recording',
        method: 'POST',
        body: {
          recording: { recordingType: 'AUDIO' },
          transcription: { language: 'hr-HR' },
        },
      },
      { url: '/calls/1/calls/call-1/stop-recording', method: 'POST', body: null },
      { url: '/calls/1/calls/call-1/hangup', method: 'POST', body: null },
      { url: '/calls/1/recordings/calls/call-1', method: 'GET', body: null },
      { url: '/calls/1/recordings/files/file-1', method: 'DELETE', body: null },
      { url: '/calls/1/recordings/files/file-1/transcription', method: 'GET', body: null },
    ],
  );
});

test('HTTP failures map retryability and downloads enforce byte limits', async () => {
  for (const [status, retryable] of [
    [400, false],
    [429, true],
    [503, true],
  ] as const) {
    const client = new InfobipClient({ config, fetch: async () => new Response('', { status }) });
    await assert.rejects(
      client.answerCall('call-1'),
      (error) =>
        error instanceof ChannelProviderError &&
        error.code === 'http_error' &&
        error.retryable === retryable,
    );
  }
  const client = new InfobipClient({
    config,
    fetch: async () => new Response(new Uint8Array([1, 2, 3])),
  });
  await assert.rejects(
    client.fetchRecording('file-1', 2, 1000),
    (error) => error instanceof ChannelProviderError && error.code === 'download_too_large',
  );
});

test('sendSms rejects malformed success response', async () => {
  const client = new InfobipClient({ config, fetch: async () => Response.json({ messages: [] }) });
  await assert.rejects(
    client.sendSms({ to: '+385921111111', text: 'Poruka', idempotencyKey: 'idem-1' }),
    (error) => error instanceof ChannelProviderError && error.code === 'invalid_response',
  );
});

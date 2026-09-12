// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { ChannelProviderError } from './channel-provider.js';
import { TelnyxClient, type FetchImplementation } from './telnyx-client.js';

const config = {
  numberE164: '+385911111111',
  apiKey: 'key-1',
  publicKey: 'pub',
  messagingProfileId: 'profile-1',
  connectionId: 'conn-1',
  ttsVoice: 'Azure.hr-HR-GabrijelaNeural',
  signatureToleranceSeconds: 300,
};

test('sendSms posts Telnyx message shape with bearer and idempotency key', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchImplementation = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ data: { id: 'msg-1' } }, { status: 200 });
  };
  const client = new TelnyxClient({ config, fetch: fetchImpl });

  const result = await client.sendSms({
    to: '+385921111111',
    text: 'Poruka',
    idempotencyKey: 'idem-1',
  });

  assert.deepEqual(result, { providerMessageId: 'msg-1' });
  assert.equal(calls[0]?.url, 'https://api.telnyx.com/v2/messages');
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, 'Bearer key-1');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key'], 'idem-1');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    from: '+385911111111',
    to: '+385921111111',
    text: 'Poruka',
    messaging_profile_id: 'profile-1',
  });
});

test('call control methods post expected Telnyx action payloads', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: FetchImplementation = async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ data: { id: 'ok' } }, { status: 200 });
  };
  const client = new TelnyxClient({ config, fetch: fetchImpl });

  await client.answerCall('call-1', 'state-1');
  await client.speak('call-1', {
    text: 'Dobar dan',
    voice: 'Azure.hr-HR-GabrijelaNeural',
    language: 'hr-HR',
  });
  await client.recordStart('call-1', {
    format: 'wav',
    channels: 'single',
    maxLengthSeconds: 60,
    timeoutSeconds: 3,
    trim: 'trim-silence',
    playBeep: true,
    commandId: 'rec-1',
  });
  await client.hangup('call-1');

  assert.equal(calls[0]?.url, 'https://api.telnyx.com/v2/calls/call-1/actions/answer');
  assert.deepEqual(calls[0]?.body, { client_state: 'state-1' });
  assert.equal(calls[1]?.url, 'https://api.telnyx.com/v2/calls/call-1/actions/speak');
  assert.deepEqual(calls[1]?.body, {
    payload: 'Dobar dan',
    voice: 'Azure.hr-HR-GabrijelaNeural',
    language: 'hr-HR',
  });
  assert.equal(calls[2]?.url, 'https://api.telnyx.com/v2/calls/call-1/actions/record_start');
  assert.deepEqual(calls[2]?.body, {
    format: 'wav',
    channels: 'single',
    max_length: 60,
    timeout_secs: 3,
    trim: 'trim-silence',
    play_beep: true,
    command_id: 'rec-1',
  });
  assert.equal(calls[3]?.url, 'https://api.telnyx.com/v2/calls/call-1/actions/hangup');
});

test('sendSms rejects invalid success response strictly', async () => {
  const client = new TelnyxClient({ config, fetch: async () => Response.json({ data: {} }) });
  await assert.rejects(
    client.sendSms({ to: '+385921111111', text: 'Poruka', idempotencyKey: 'idem-1' }),
    (error) => error instanceof ChannelProviderError && error.code === 'invalid_response',
  );
});

test('fetchRecording enforces byte limit', async () => {
  const client = new TelnyxClient({
    config,
    fetch: async () => new Response(new Uint8Array([1, 2, 3])),
  });
  await assert.rejects(
    client.fetchRecording('https://recording.example/audio.wav', 2, 1000),
    (error) => error instanceof ChannelProviderError && error.code === 'download_too_large',
  );
});

// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import type { InfobipConfig } from './config.js';
import { createInfobipSttProvider } from './infobip-stt.js';
import { SttProviderError } from './stt-provider.js';

const config: InfobipConfig = {
  baseUrl: 'https://account.api.infobip.com/',
  apiKey: 'key-1',
  webhookSecret: 'a-real-webhook-secret-at-least-32-characters',
  webhookSignatureHeader: 'x-hub-signature',
  sender: '+385911111111',
  callsConfigurationId: 'calls-1',
  ttsLanguage: 'hr',
};

test('Infobip STT reads transcription by provider file ID and ignores audio', async () => {
  const provider = createInfobipSttProvider(config, async (input, init) => {
    assert.equal(
      String(input),
      'https://account.api.infobip.com/calls/1/recordings/files/file-1/transcription',
    );
    assert.equal((init?.headers as Record<string, string>).Authorization, 'App key-1');
    return Response.json({ text: 'tekst' });
  });
  assert.deepEqual(
    await provider.transcribe({
      audio: new Uint8Array([9, 8, 7]),
      mimeType: 'audio/wav',
      languageHint: 'hr',
      providerFileId: 'file-1',
    }),
    { text: 'tekst', durationSeconds: null },
  );
});

test('Infobip STT rejects missing file IDs and malformed responses', async () => {
  const missing = createInfobipSttProvider(config, async () => Response.json({ text: 'unused' }));
  await assert.rejects(
    missing.transcribe({ audio: new Uint8Array(), mimeType: 'audio/wav', languageHint: 'hr' }),
    (error) => error instanceof SttProviderError && error.code === 'stt_provider_file_required',
  );

  const malformed = createInfobipSttProvider(config, async () => Response.json({ text: 1 }));
  await assert.rejects(
    malformed.transcribe({
      audio: new Uint8Array(),
      mimeType: 'audio/wav',
      languageHint: 'hr',
      providerFileId: 'file-1',
    }),
    (error) => error instanceof SttProviderError && error.code === 'stt_malformed_response',
  );
});

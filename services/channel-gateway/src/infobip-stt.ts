// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InfobipConfig } from './config.js';
import { INFOBIP_API_PATHS, INFOBIP_AUTHORIZATION_HEADER } from './infobip-api.js';
import type { FetchImplementation } from './infobip-client.js';
import type { SttProvider } from './pipeline-types.js';
import { SttProviderError } from './stt-provider.js';

export function createInfobipSttProvider(
  config: InfobipConfig,
  fetchImpl: FetchImplementation = fetch,
): SttProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  return {
    name: 'infobip',
    async transcribe(input) {
      if (!input.providerFileId) {
        throw new SttProviderError('Infobip transcription requires a provider file ID', {
          code: 'stt_provider_file_required',
        });
      }
      let response: Response;
      try {
        response = await fetchImpl(
          `${baseUrl}${INFOBIP_API_PATHS.transcription(input.providerFileId)}`,
          { headers: { [INFOBIP_AUTHORIZATION_HEADER]: `App ${config.apiKey}` } },
        );
      } catch (cause) {
        throw new SttProviderError('Infobip transcription request failed', {
          code: 'stt_request_failed',
          cause,
        });
      }
      if (!response.ok) {
        throw new SttProviderError(`Infobip transcription returned HTTP ${response.status}`, {
          code: 'stt_http_error',
          status: response.status,
        });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw new SttProviderError('Infobip transcription response was not valid JSON', {
          code: 'stt_malformed_response',
          status: response.status,
          cause,
        });
      }
      if (
        body === null ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        !('text' in body) ||
        typeof body.text !== 'string'
      ) {
        throw new SttProviderError('Infobip transcription response must contain string text', {
          code: 'stt_malformed_response',
          status: response.status,
        });
      }
      return { text: body.text, durationSeconds: null };
    },
  };
}

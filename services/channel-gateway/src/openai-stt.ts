// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SttConfig } from './config.js';
import type { SttProvider } from './pipeline-types.js';
import { SttProviderError } from './stt-provider.js';

export type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

export function createOpenAiSttProvider(config: SttConfig, fetchImpl: FetchLike = fetch): SttProvider {
  return {
    name: 'openai-compatible',
    async transcribe(input) {
      if (input.audio.byteLength > config.maxBytes) {
        throw new SttProviderError(
          `STT audio is ${input.audio.byteLength} bytes; maximum is ${config.maxBytes} bytes`,
          { code: 'stt_audio_too_large' },
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const form = new FormData();
        const audio = input.audio.buffer.slice(
          input.audio.byteOffset,
          input.audio.byteOffset + input.audio.byteLength,
        ) as ArrayBuffer;
        form.set('file', new Blob([audio], { type: input.mimeType }), 'recording.wav');
        form.set('model', config.model);
        form.set('language', input.languageHint);
        form.set('response_format', 'json');

        const response = await fetchImpl(new URL('audio/transcriptions', withTrailingSlash(config.baseUrl)), {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
          signal: controller.signal,
        });
        return await parseTranscriptionResponse(response);
      } catch (error) {
        if (error instanceof SttProviderError) throw error;
        if (controller.signal.aborted) {
          throw new SttProviderError(`STT request timed out after ${config.timeoutMs} ms`, {
            code: 'stt_timeout',
            cause: error,
          });
        }
        throw new SttProviderError('STT request failed', { code: 'stt_request_failed', cause: error });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function parseTranscriptionResponse(response: Response) {
  const bodyText = await response.text();
  let body: unknown;
  try {
    body = bodyText.length === 0 ? null : JSON.parse(bodyText);
  } catch (error) {
    throw new SttProviderError('STT response was not valid JSON', {
      code: 'stt_malformed_response',
      status: response.status,
      cause: error,
    });
  }

  if (!response.ok) {
    throw new SttProviderError(`STT provider returned HTTP ${response.status}`, {
      code: 'stt_http_error',
      status: response.status,
    });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('text' in body)) {
    throw new SttProviderError('STT response must be an object with string text', {
      code: 'stt_malformed_response',
      status: response.status,
    });
  }
  const text = body.text;
  const duration = 'duration' in body ? body.duration : null;
  if (typeof text !== 'string') {
    throw new SttProviderError('STT response text must be a string', {
      code: 'stt_malformed_response',
      status: response.status,
    });
  }
  if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) {
    throw new SttProviderError('STT response duration must be a non-negative number when present', {
      code: 'stt_malformed_response',
      status: response.status,
    });
  }
  return { text, durationSeconds: duration };
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

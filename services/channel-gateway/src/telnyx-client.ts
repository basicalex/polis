// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithTimeout } from '@polis/service-runtime';

import { ChannelProviderError, type ChannelProvider } from './channel-provider.js';
import type { TelnyxConfig } from './config.js';
import type { RecordStartInput, SendSmsInput, SpeakInput } from './pipeline-types.js';

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_BASE_URL = 'https://api.telnyx.com/v2';
const REQUEST_TIMEOUT_MS = 5_000;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChannelProviderError('Telnyx returned an invalid response', {
      code: 'invalid_response',
    });
  }
  return value as Record<string, unknown>;
}

function telnyxId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ChannelProviderError('Telnyx returned an invalid response', {
      code: 'invalid_response',
    });
  }
  return value;
}

export interface TelnyxClientOptions {
  readonly config: TelnyxConfig;
  readonly fetch?: FetchImplementation;
  readonly baseUrl?: string;
}

export class TelnyxClient implements ChannelProvider {
  readonly name = 'telnyx' as const;
  readonly #config: TelnyxConfig;
  readonly #fetch: FetchImplementation;
  readonly #baseUrl: string;

  constructor(options: TelnyxClientOptions) {
    this.#config = options.config;
    this.#fetch =
      options.fetch ?? ((input, init) => fetchWithTimeout(input, init, REQUEST_TIMEOUT_MS));
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async sendSms(input: SendSmsInput): Promise<{ providerMessageId: string }> {
    const body = {
      from: this.#config.numberE164,
      to: input.to,
      text: input.text,
      messaging_profile_id: this.#config.messagingProfileId,
    };
    const json = await this.#request('/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const data = record(record(json).data);
    return { providerMessageId: telnyxId(data.id) };
  }

  async answerCall(callControlId: string, clientState: string): Promise<void> {
    await this.#callAction(callControlId, 'answer', { client_state: clientState });
  }

  async speak(callControlId: string, input: SpeakInput): Promise<void> {
    await this.#callAction(callControlId, 'speak', {
      payload: input.text,
      voice: input.voice,
      language: input.language,
      ...(input.clientState ? { client_state: input.clientState } : {}),
    });
  }

  async recordStart(callControlId: string, input: RecordStartInput): Promise<void> {
    await this.#callAction(callControlId, 'record_start', {
      format: input.format,
      channels: input.channels,
      max_length: input.maxLengthSeconds,
      timeout_secs: input.timeoutSeconds,
      trim: input.trim,
      play_beep: input.playBeep,
      command_id: input.commandId,
      ...(input.clientState ? { client_state: input.clientState } : {}),
    });
  }

  async hangup(callControlId: string): Promise<void> {
    await this.#callAction(callControlId, 'hangup', {});
  }

  async fetchRecording(url: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new ChannelProviderError('Telnyx recording limits are invalid', {
        code: 'invalid_config',
      });
    }
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { Authorization: `Bearer ${this.#config.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new ChannelProviderError('Telnyx recording download failed', {
        code: 'network_error',
        retryable: true,
        cause,
      });
    }
    if (!response.ok) {
      throw new ChannelProviderError('Telnyx recording download was rejected', {
        code: 'http_error',
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new ChannelProviderError('Telnyx recording exceeded the download limit', {
        code: 'download_too_large',
        status: response.status,
      });
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ChannelProviderError('Telnyx recording exceeded the download limit', {
          code: 'download_too_large',
          status: response.status,
        });
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async deleteRecording(recordingId: string): Promise<void> {
    await this.#request(`/recordings/${encodeURIComponent(recordingId)}`, { method: 'DELETE' });
  }

  async #callAction(
    callControlId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.#request(`/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.#config.apiKey}` },
      });
    } catch (cause) {
      throw new ChannelProviderError('Telnyx request failed', {
        code: 'network_error',
        retryable: true,
        cause,
      });
    }
    if (!response.ok)
      throw new ChannelProviderError('Telnyx request was rejected', {
        code: 'http_error',
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    if (response.status === 204) return {};
    try {
      return await response.json();
    } catch (cause) {
      throw new ChannelProviderError('Telnyx returned an invalid response', {
        code: 'invalid_response',
        status: response.status,
        cause,
      });
    }
  }
}

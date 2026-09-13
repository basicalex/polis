// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithTimeout } from '@polis/service-runtime';

import { ChannelProviderError, type ChannelProvider } from './channel-provider.js';
import type { InfobipConfig } from './config.js';
import {
  INFOBIP_API_PATHS,
  INFOBIP_AUTHORIZATION_HEADER,
  INFOBIP_CONTENT_TYPE_HEADER,
} from './infobip-api.js';
import type { RecordStartInput, SendSmsInput, SpeakInput } from './pipeline-types.js';

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 5_000;

export interface InfobipClientOptions {
  readonly config: InfobipConfig;
  readonly fetch?: FetchImplementation;
}

export class InfobipClient implements ChannelProvider {
  readonly name = 'infobip' as const;
  readonly #config: InfobipConfig;
  readonly #fetch: FetchImplementation;
  readonly #baseUrl: string;

  constructor(options: InfobipClientOptions) {
    this.#config = options.config;
    this.#fetch =
      options.fetch ?? ((input, init) => fetchWithTimeout(input, init, REQUEST_TIMEOUT_MS));
    this.#baseUrl = options.config.baseUrl.replace(/\/$/, '');
  }

  async sendSms(input: SendSmsInput): Promise<{ providerMessageId: string }> {
    const json = await this.#requestJson(INFOBIP_API_PATHS.sendSms, {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            from: this.#config.sender,
            destinations: [{ to: input.to, messageId: input.idempotencyKey }],
            text: input.text,
          },
        ],
      }),
    });
    const messages = this.#record(json).messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw this.#invalidResponse();
    }
    const messageId = this.#record(messages[0]).messageId;
    if (typeof messageId !== 'string' || messageId.length === 0) throw this.#invalidResponse();
    return { providerMessageId: messageId };
  }

  async answerCall(callId: string): Promise<void> {
    await this.#requestJson(INFOBIP_API_PATHS.answerCall(callId), { method: 'POST' });
  }

  async speak(callId: string, input: SpeakInput): Promise<void> {
    await this.#requestJson(INFOBIP_API_PATHS.say(callId), {
      method: 'POST',
      body: JSON.stringify({
        text: input.text,
        language: input.language,
        ...(input.voice ? { voice: { name: input.voice } } : {}),
      }),
    });
  }

  async recordStart(callId: string, input: RecordStartInput): Promise<void> {
    await this.#requestJson(INFOBIP_API_PATHS.startRecording(callId), {
      method: 'POST',
      body: JSON.stringify({
        recording: { recordingType: 'AUDIO' },
        ...(input.transcription ? { transcription: { language: 'hr-HR' } } : {}),
      }),
    });
  }

  async stopRecording(callId: string): Promise<void> {
    await this.#requestJson(INFOBIP_API_PATHS.stopRecording(callId), { method: 'POST' });
  }

  async hangup(callId: string): Promise<void> {
    await this.#requestJson(INFOBIP_API_PATHS.hangup(callId), { method: 'POST' });
  }

  async listRecordings(
    callId: string,
  ): Promise<Array<{ fileId: string; durationSeconds: number | null }>> {
    const json = this.#record(
      await this.#requestJson(INFOBIP_API_PATHS.listRecordings(callId), { method: 'GET' }),
    );
    if (!Array.isArray(json.files)) throw this.#invalidResponse();
    return json.files.map((entry) => {
      const file = this.#record(entry);
      if (typeof file.fileId !== 'string' || file.fileId.length === 0) {
        throw this.#invalidResponse();
      }
      const duration = file.durationSeconds ?? null;
      if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration))) {
        throw this.#invalidResponse();
      }
      return { fileId: file.fileId, durationSeconds: duration as number | null };
    });
  }

  async fetchRecording(fileId: string, maxBytes: number, timeoutMs: number): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new ChannelProviderError('Infobip recording limits are invalid', {
        code: 'invalid_config',
      });
    }
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${INFOBIP_API_PATHS.recordingFile(fileId)}`, {
        headers: this.#headers(false),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new ChannelProviderError('Infobip recording download failed', {
        code: 'network_error',
        retryable: true,
        cause,
      });
    }
    if (!response.ok) throw this.#httpError('recording download', response.status);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw this.#downloadTooLarge(response.status);
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
        throw this.#downloadTooLarge(response.status);
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

  async deleteRecording(fileId: string): Promise<void> {
    await this.#requestJson(INFOBIP_API_PATHS.recordingFile(fileId), { method: 'DELETE' });
  }

  async fetchTranscription(fileId: string): Promise<{ text: string }> {
    const json = this.#record(
      await this.#requestJson(INFOBIP_API_PATHS.transcription(fileId), { method: 'GET' }),
    );
    if (typeof json.text !== 'string') throw this.#invalidResponse();
    return { text: json.text };
  }

  async #requestJson(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: { ...this.#headers(init.body !== undefined), ...init.headers },
      });
    } catch (cause) {
      throw new ChannelProviderError('Infobip request failed', {
        code: 'network_error',
        retryable: true,
        cause,
      });
    }
    if (!response.ok) throw this.#httpError('request', response.status);
    if (response.status === 204 || response.headers.get('content-length') === '0') return {};
    const text = await response.text();
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new ChannelProviderError('Infobip returned an invalid response', {
        code: 'invalid_response',
        status: response.status,
        cause,
      });
    }
  }

  #headers(json: boolean): Record<string, string> {
    return {
      [INFOBIP_AUTHORIZATION_HEADER]: `App ${this.#config.apiKey}`,
      ...(json ? { [INFOBIP_CONTENT_TYPE_HEADER]: 'application/json' } : {}),
    };
  }

  #record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw this.#invalidResponse();
    }
    return value as Record<string, unknown>;
  }

  #invalidResponse(): ChannelProviderError {
    return new ChannelProviderError('Infobip returned an invalid response', {
      code: 'invalid_response',
    });
  }

  #httpError(operation: string, status: number): ChannelProviderError {
    return new ChannelProviderError(`Infobip ${operation} was rejected`, {
      code: 'http_error',
      status,
      retryable: status === 429 || status >= 500,
    });
  }

  #downloadTooLarge(status: number): ChannelProviderError {
    return new ChannelProviderError('Infobip recording exceeded the download limit', {
      code: 'download_too_large',
      status,
    });
  }
}

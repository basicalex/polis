// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelConfig } from './config.js';
import { createInfobipSttProvider } from './infobip-stt.js';
import type { FetchImplementation } from './infobip-client.js';
import { createOpenAiSttProvider } from './openai-stt.js';
import { createStubSttProvider } from './stub-stt.js';

export type { SttProvider } from './pipeline-types.js';

export class SttProviderError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, options: { code: string; status?: number | null; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'SttProviderError';
    this.code = options.code;
    this.status = options.status ?? null;
  }
}

export function createSttProvider(config: ChannelConfig, fetchImpl?: FetchImplementation) {
  if (config.sttProvider === 'stub') return createStubSttProvider();
  if (config.sttProvider === 'infobip') {
    if (!config.infobip) {
      throw new SttProviderError('Infobip configuration is required for Infobip STT', {
        code: 'stt_config_missing',
      });
    }
    return createInfobipSttProvider(config.infobip, fetchImpl);
  }
  if (!config.stt) {
    throw new SttProviderError('STT configuration is required for openai-compatible provider', {
      code: 'stt_config_missing',
    });
  }
  return createOpenAiSttProvider(config.stt, fetchImpl);
}

// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChannelConfig } from './config.js';
import { createOpenAiSttProvider, type FetchLike } from './openai-stt.js';
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

export function createSttProvider(config: ChannelConfig, fetchImpl?: FetchLike) {
  if (config.sttProvider === 'stub') return createStubSttProvider();
  if (!config.stt) {
    throw new SttProviderError('STT configuration is required for openai-compatible provider', {
      code: 'stt_config_missing',
    });
  }
  return createOpenAiSttProvider(config.stt, fetchImpl);
}

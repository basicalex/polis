// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

export type {
  ChannelProvider,
  RecordStartInput,
  SendSmsInput,
  SpeakInput,
} from './pipeline-types.js';

export interface ChannelProviderErrorOptions {
  readonly code: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class ChannelProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: ChannelProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ChannelProviderError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

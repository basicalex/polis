// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChannelProviderError, type ChannelProvider } from './channel-provider.js';
import type { ChannelConfig } from './config.js';
import { StubChannelProvider } from './stub-provider.js';
import { TelnyxClient, type FetchImplementation } from './telnyx-client.js';

export function createChannelProvider(
  config: ChannelConfig,
  fetchImpl?: FetchImplementation,
): ChannelProvider {
  if (config.channelProvider === 'stub') return new StubChannelProvider();
  if (!config.telnyx) {
    throw new ChannelProviderError('Telnyx configuration is incomplete', {
      code: 'invalid_config',
    });
  }
  const values = [
    config.telnyx.numberE164,
    config.telnyx.apiKey,
    config.telnyx.publicKey,
    config.telnyx.messagingProfileId,
    config.telnyx.connectionId,
    config.telnyx.ttsVoice,
  ];
  if (
    values.some((value) => value.trim() === '') ||
    !Number.isSafeInteger(config.telnyx.signatureToleranceSeconds) ||
    config.telnyx.signatureToleranceSeconds < 0
  ) {
    throw new ChannelProviderError('Telnyx configuration is incomplete', {
      code: 'invalid_config',
    });
  }
  return new TelnyxClient({ config: config.telnyx, fetch: fetchImpl });
}

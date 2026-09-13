// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChannelProviderError, type ChannelProvider } from './channel-provider.js';
import type { ChannelConfig } from './config.js';
import { StubChannelProvider } from './stub-provider.js';
import { InfobipClient, type FetchImplementation } from './infobip-client.js';

export function createChannelProvider(
  config: ChannelConfig,
  fetchImpl?: FetchImplementation,
): ChannelProvider {
  if (config.channelProvider === 'stub') return new StubChannelProvider();
  if (!config.infobip) {
    throw new ChannelProviderError('Infobip configuration is incomplete', {
      code: 'invalid_config',
    });
  }
  const values = [
    config.infobip.baseUrl,
    config.infobip.apiKey,
    config.infobip.webhookSecret,
    config.infobip.webhookSignatureHeader,
    config.infobip.sender,
    config.infobip.callsConfigurationId,
    config.infobip.ttsLanguage,
  ];
  if (values.some((value) => value.trim() === '')) {
    throw new ChannelProviderError('Infobip configuration is incomplete', {
      code: 'invalid_config',
    });
  }
  return new InfobipClient({ config: config.infobip, fetch: fetchImpl });
}

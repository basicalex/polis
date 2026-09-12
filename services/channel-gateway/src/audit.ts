// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fetchWithTimeout, internalHeaders } from '@polis/service-runtime';

import type { ChannelConfig } from './config.js';
import type { AuditClient } from './pipeline-types.js';
import type { FetchImplementation } from './telnyx-client.js';
import type { ChannelKind } from './types.js';

const AUDIT_TIMEOUT_MS = 5_000;

interface AuditEvent {
  eventType: string;
  code: string;
  channel?: ChannelKind;
  eventId?: string;
  phoneHashPrefix?: string;
  caseNumber?: string;
  recordId?: string;
}

export class HttpAuditClient implements AuditClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchImplementation;

  constructor(config: ChannelConfig, fetchImpl?: FetchImplementation) {
    this.#baseUrl = config.auditInternalUrl.replace(/\/$/, '');
    this.#fetch = fetchImpl ?? ((input, init) => fetchWithTimeout(input, init, AUDIT_TIMEOUT_MS));
  }

  async emit(event: AuditEvent): Promise<void> {
    try {
      await this.#fetch(`${this.#baseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          eventType: event.eventType,
          action: event.code,
          visibility: 'restricted',
          actor: { type: 'service', id: 'channel-gateway' },
          target: {
            type: 'channel_gateway',
            id: event.recordId ?? event.caseNumber ?? event.eventId ?? 'channel',
          },
          data: {
            eventId: event.eventId,
            phoneHashPrefix: event.phoneHashPrefix,
            caseNumber: event.caseNumber,
            recordId: event.recordId,
            channel: event.channel,
            code: event.code,
          },
        }),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          service: 'channel-gateway',
          stage: 'audit-emit',
          warning: error instanceof Error ? error.message : 'unknown',
        }),
      );
    }
  }
}

export function createAuditClient(
  config: ChannelConfig,
  fetchImpl?: FetchImplementation,
): AuditClient {
  return new HttpAuditClient(config, fetchImpl);
}

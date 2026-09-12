// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { internalHeaders } from '@polis/service-runtime';

import type { ChannelConfig } from './config.js';
import type { ChannelKind } from './types.js';
import type { TraceChannelCase, TraceClient, TraceOutboxMessage } from './pipeline-types.js';
import type { FetchImplementation } from './telnyx-client.js';

const TRACE_TIMEOUT_MS = 5_000;

export interface TraceClientErrorOptions {
  readonly code: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class TraceClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: TraceClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'TraceClientError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TraceClientError('Trace returned an invalid response', { code: 'invalid_response' });
  }
  return value as Record<string, unknown>;
}

function requiredString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TraceClientError('Trace returned an invalid response', { code: 'invalid_response' });
  }
  return value;
}

interface CreateChannelCaseInput {
  channel: ChannelKind;
  text: string | null;
  location?: string;
  source: 'typed' | 'transcript' | 'system';
  occurredAt: string;
}

interface AppendChannelMessageInput {
  reopenKey: string;
  channel: ChannelKind;
  kind: 'append' | 'transcript' | 'transcript-failed';
  text: string | null;
  source: 'typed' | 'transcript' | 'system';
  occurredAt: string;
}

interface MarkDeliveryInput {
  state: 'handed-off' | 'delivered' | 'failed';
  failureCode?: string;
}

export class HttpTraceClient implements TraceClient {
  readonly #baseUrl: string;
  readonly #actorId: string;
  readonly #fetch: FetchImplementation;

  constructor(config: ChannelConfig, fetchImpl?: FetchImplementation) {
    this.#baseUrl = config.traceInternalUrl.replace(/\/$/, '');
    this.#actorId = config.traceGatewayActorId;
    this.#fetch = fetchImpl ?? globalThis.fetch;
  }

  async createChannelCase(input: CreateChannelCaseInput, idempotencyKey: string): Promise<{ case: TraceChannelCase }> {
    const json = record(await this.#request('/internal/trace/channel/cases', 'POST', input, idempotencyKey, 201));
    const source = record(json.case);
    return { case: { recordId: requiredString(source, 'recordId'), caseNumber: requiredString(source, 'caseNumber'), reopenKey: requiredString(source, 'reopenKey'), state: requiredString(source, 'state') } };
  }

  async appendChannelMessage(caseNumber: string, input: AppendChannelMessageInput, idempotencyKey: string): Promise<{ message: { id: string } }> {
    const json = record(await this.#request(`/internal/trace/channel/cases/${encodeURIComponent(caseNumber)}/messages`, 'POST', input, idempotencyKey, 201));
    const message = record(json.message);
    return { message: { id: requiredString(message, 'id') } };
  }

  async listOutbox(limit: number): Promise<{ messages: TraceOutboxMessage[] }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TraceClientError('Trace outbox limit is invalid', { code: 'invalid_request' });
    }
    const json = record(
      await this.#request(
        `/internal/trace/channel/outbox?limit=${encodeURIComponent(String(limit))}`,
        'GET',
        undefined,
        `list-outbox:${limit}`,
      ),
    );
    if (!Array.isArray(json.messages)) {
      throw new TraceClientError('Trace returned an invalid response', {
        code: 'invalid_response',
      });
    }
    return {
      messages: json.messages.map((entry) => {
        const item = record(entry);
        return {
          id: requiredString(item, 'id'),
          recordId: requiredString(item, 'recordId'),
          kind: requiredString(item, 'kind'),
          body: requiredString(item, 'body'),
          createdAt: requiredString(item, 'createdAt'),
        };
      }),
    };
  }

  async markDelivery(messageId: string, input: MarkDeliveryInput, idempotencyKey: string): Promise<void> {
    const json = record(
      await this.#request(
        `/internal/trace/channel/outbox/${encodeURIComponent(messageId)}/delivery`,
        'POST',
        input,
        idempotencyKey,
        200,
      ),
    );
    const message = record(json.message);
    requiredString(message, 'id');
  }

  async #request(path: string, method: string, body?: unknown, idempotencyKey?: string, expectedStatus?: number): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        signal: AbortSignal.timeout(TRACE_TIMEOUT_MS),
        headers: internalHeaders({
          'x-polis-trace-gateway': this.#actorId,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new TraceClientError('Trace request failed', { code: 'network_error', retryable: true, cause });
    }
    if (expectedStatus !== undefined ? response.status !== expectedStatus : !response.ok) {
      let code = 'http_error';
      try {
        const errorBody = record(await response.json());
        const providerCode = errorBody.error;
        if (typeof providerCode === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(providerCode)) {
          code = providerCode;
        }
      } catch {
        // Provider error bodies may contain sensitive data; discard them.
      }
      throw new TraceClientError('Trace request was rejected', {
        code,
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new TraceClientError('Trace returned an invalid response', { code: 'invalid_response', status: response.status, cause });
    }
  }
}

export function createTraceClient(config: ChannelConfig, fetchImpl?: FetchImplementation): TraceClient {
  return new HttpTraceClient(config, fetchImpl);
}

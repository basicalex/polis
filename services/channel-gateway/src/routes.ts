// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { operationalRoutes, result, type HttpResult, type Route } from '@polis/service-runtime';

import { phoneHash, verifyInfobipSignature } from './crypto.js';
import { INFOBIP_EVENT_TYPES } from './infobip-api.js';
import { normalizeE164 } from './phone.js';
import { handleDeliveryEvent, handleMessagingEvent, runInboxCycle } from './pipeline.js';
import type { PipelineDeps, ProviderEvent } from './pipeline-types.js';
import { deliverOutbound, runRelayCycle } from './relay.js';
import { purgeExpired } from './retention.js';
import { handleVoiceEvent } from './voice.js';

const MAX_WEBHOOK_BYTES = 65_536;

type StubMessage = { to: string; text: string; idempotencyKey: string };
type StubProviderState = { sentMessages?: StubMessage[]; commands?: string[] };

export type ChannelRouteDependencies = Partial<PipelineDeps>;

function rawBytes(body: unknown): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseVoiceEvent(rawBody: Uint8Array): ProviderEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const payload = parsed as Record<string, unknown>;
  const callId = payload.callId;
  const eventType = payload.type;
  const timestamp = payload.timestamp;
  if (
    typeof callId !== 'string' ||
    callId.length === 0 ||
    typeof eventType !== 'string' ||
    eventType.length === 0 ||
    typeof timestamp !== 'string' ||
    timestamp.length === 0
  ) {
    return null;
  }
  const topLevelId =
    typeof payload.id === 'string' && payload.id.length > 0
      ? payload.id
      : typeof payload.eventId === 'string' && payload.eventId.length > 0
        ? payload.eventId
        : null;
  return {
    id:
      topLevelId ??
      createHash('sha256').update(`${callId}|${eventType}|${timestamp}`).digest('hex'),
    eventType,
    occurredAt: timestamp,
    payload,
    payloadSha256: createHash('sha256').update(rawBody).digest('hex'),
  };
}

function verifyWebhookRequest(
  rawBody: Uint8Array,
  headers: Record<string, string | string[] | undefined>,
  deps: PipelineDeps,
): boolean {
  const infobip = deps.config.infobip;
  if (!infobip) return false;
  return verifyInfobipSignature({
    secret: infobip.webhookSecret,
    header: headerValue(headers[infobip.webhookSignatureHeader]),
    rawBody,
  });
}

function payloadString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function providerState(provider: PipelineDeps['provider']): StubProviderState {
  return provider as StubProviderState;
}

async function runSynchronousCycles(deps: PipelineDeps): Promise<void> {
  await runInboxCycle(deps);
  await runRelayCycle(deps);
  await deliverOutbound(deps);
}

async function stubResponse(
  deps: PipelineDeps,
  rawFrom: string,
  sentStart: number,
  commandStart: number,
): Promise<{
  caseNumber: string | null;
  recordId: string | null;
  sentMessages: StubMessage[];
  commands: string[];
}> {
  await runSynchronousCycles(deps);
  let caseNumber: string | null = null;
  let recordId: string | null = null;
  try {
    const e164 = normalizeE164(rawFrom);
    const hash = phoneHash(e164, deps.config.vaultPepper, deps.config.municipalityId);
    const link = (await deps.store.listOpenLinks(hash))[0];
    caseNumber = link?.caseNumber ?? null;
    recordId = link?.recordId ?? null;
  } catch {
    // Invalid senders are accepted and ignored by the inbound pipeline.
  }
  const state = providerState(deps.provider);
  const sentMessages = Array.isArray(state.sentMessages)
    ? state.sentMessages.slice(sentStart).map((message) => ({
        to: '[redacted]',
        text: message.text,
        idempotencyKey: message.idempotencyKey,
      }))
    : [];
  const commands = Array.isArray(state.commands) ? state.commands.slice(commandStart) : [];
  return { caseNumber, recordId, sentMessages, commands };
}

function routeResult(value: { status: number; body: unknown }): HttpResult {
  return result(value.status, value.body);
}

function hasPipelineDeps(deps: Partial<PipelineDeps>): deps is PipelineDeps {
  return Boolean(
    deps.config && deps.store && deps.provider && deps.trace && deps.audit && deps.log && deps.now,
  );
}

export function channelRoutes(deps: Partial<PipelineDeps> = {}): Route[] {
  const readiness = deps.store
    ? async () => {
        try {
          await deps.store!.ping();
          return { ready: true };
        } catch {
          return { ready: false, dependency: 'database' };
        }
      }
    : undefined;
  const operational = operationalRoutes('channel-gateway', readiness);
  if (!hasPipelineDeps(deps)) return operational;
  const fullDeps = deps;
  const routes: Route[] = [
    ...operational,
    {
      method: 'POST',
      path: '/internal/channel/webhooks/infobip/sms',
      bodyMode: 'raw',
      maxBodyBytes: MAX_WEBHOOK_BYTES,
      handler: async (req, body) =>
        routeResult(await handleMessagingEvent(rawBytes(body), req.headers, fullDeps)),
    },
    {
      method: 'POST',
      path: '/internal/channel/webhooks/infobip/sms-reports',
      bodyMode: 'raw',
      maxBodyBytes: MAX_WEBHOOK_BYTES,
      handler: async (req, body) =>
        routeResult(await handleDeliveryEvent(rawBytes(body), req.headers, fullDeps)),
    },
    {
      method: 'POST',
      path: '/internal/channel/webhooks/infobip/calls',
      bodyMode: 'raw',
      maxBodyBytes: MAX_WEBHOOK_BYTES,
      handler: async (req, body) => {
        const rawBody = rawBytes(body);
        if (!verifyWebhookRequest(rawBody, req.headers, fullDeps)) {
          return result(401, { error: 'invalid_signature' });
        }
        const event = parseVoiceEvent(rawBody);
        if (!event) return result(400, { error: 'invalid_event' });
        const recorded = await fullDeps.store.recordEvent(
          fullDeps.provider.name,
          event.id,
          event.eventType,
          event.payloadSha256,
        );
        if (recorded.duplicate) return result(202, { accepted: true, duplicate: true });
        queueMicrotask(() => {
          void handleVoiceEvent(event, fullDeps)
            .then(() => fullDeps.store.markEvent(fullDeps.provider.name, event.id, 'processed'))
            .catch(async (error: unknown) => {
              await fullDeps.store.markEvent(
                fullDeps.provider.name,
                event.id,
                'failed',
                error instanceof Error ? error.message : 'voice_webhook_failed',
              );
              fullDeps.log({
                service: 'channel-gateway',
                stage: 'voice-webhook',
                code: 'processing_failed',
                eventId: event.id,
                error: error instanceof Error ? error.message : 'voice_webhook_failed',
              });
            });
        });
        return result(202, { accepted: true, duplicate: false });
      },
    },
    {
      method: 'POST',
      path: '/internal/channel/admin/purge',
      handler: () => purgeExpired(fullDeps.store, fullDeps.now()),
    },
  ];

  if (fullDeps.config.channelProvider !== 'stub' || !fullDeps.config.allowStubInjection) {
    return routes;
  }

  routes.push(
    {
      method: 'POST',
      path: '/internal/channel/stub/inbound-sms',
      handler: async (_req: IncomingMessage, body: unknown) => {
        const input =
          typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        const from = payloadString(input.from);
        const text = payloadString(input.text);
        if (!from || !text) return result(400, { error: 'invalid_stub_message' });
        const state = providerState(fullDeps.provider);
        const sentStart = state.sentMessages?.length ?? 0;
        const commandStart = state.commands?.length ?? 0;
        const accepted = await handleMessagingEvent(
          Buffer.from(
            JSON.stringify({
              results: [
                {
                  messageId: `stub-message-${randomUUID()}`,
                  from,
                  to: fullDeps.config.infobip?.sender ?? '+38500000000',
                  text,
                  receivedAt: fullDeps.now().toISOString(),
                },
              ],
              messageCount: 1,
              pendingMessageCount: 0,
            }),
          ),
          {},
          fullDeps,
          { stubInjection: true, scheduleProcessing: false },
        );
        if (accepted.status >= 400) return routeResult(accepted);
        return stubResponse(fullDeps, from, sentStart, commandStart);
      },
    },
    {
      method: 'POST',
      path: '/internal/channel/stub/inbound-call',
      handler: async (_req: IncomingMessage, body: unknown) => {
        const input =
          typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
        const from = payloadString(input.from);
        if (!from) return result(400, { error: 'invalid_stub_call' });
        let e164: string;
        try {
          e164 = normalizeE164(from);
        } catch {
          return result(400, { error: 'invalid_stub_call' });
        }
        const state = providerState(fullDeps.provider);
        const sentStart = state.sentMessages?.length ?? 0;
        const commandStart = state.commands?.length ?? 0;
        const id = `stub-call-${randomUUID()}`;
        const timestamp = fullDeps.now().toISOString();
        const call = { id, direction: 'INBOUND', from: e164, to: '+38500000000' };
        const voiceEvent = async (
          eventType: string,
          properties: Record<string, unknown>,
        ): Promise<void> => {
          await handleVoiceEvent(
            {
              id: `stub-voice-${randomUUID()}`,
              eventType,
              occurredAt: timestamp,
              payload: { callId: id, type: eventType, timestamp, properties },
              payloadSha256: createHash('sha256')
                .update(`${id}|${eventType}|${timestamp}`)
                .digest('hex'),
            },
            fullDeps,
          );
        };
        await voiceEvent(INFOBIP_EVENT_TYPES.callReceived, { call });
        await voiceEvent(INFOBIP_EVENT_TYPES.callEstablished, { call });
        await voiceEvent(INFOBIP_EVENT_TYPES.sayFinished, { call });
        await voiceEvent(INFOBIP_EVENT_TYPES.callRecordingStopped, {
          call,
          recording: { files: [{ fileId: `stub-rec-${id}`, durationSeconds: 1 }] },
        });
        return stubResponse(fullDeps, from, sentStart, commandStart);
      },
    },
  );
  return routes;
}

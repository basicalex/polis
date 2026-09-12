// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { operationalRoutes, result, type HttpResult, type Route } from '@polis/service-runtime';

import { verifyTelnyxSignature } from './crypto.js';
import { phoneHash } from './crypto.js';
import { normalizeE164 } from './phone.js';
import { handleMessagingEvent, runInboxCycle } from './pipeline.js';
import type { PipelineDeps, TelnyxEvent } from './pipeline-types.js';
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

function parseEvent(rawBody: Uint8Array): TelnyxEvent | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof envelope !== 'object' || envelope === null || !('data' in envelope)) return null;
  const data = (envelope as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  if (typeof record.event_type !== 'string' || record.event_type.length === 0) return null;
  const payload = record.payload;
  return {
    id: record.id,
    eventType: record.event_type,
    occurredAt: typeof record.occurred_at === 'string' ? record.occurred_at : null,
    payload:
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {},
    payloadSha256: createHash('sha256').update(rawBody).digest('hex'),
  };
}

function verifyWebhookRequest(
  rawBody: Uint8Array,
  headers: Record<string, string | string[] | undefined>,
  deps: PipelineDeps,
): boolean {
  const telnyx = deps.config.telnyx;
  if (!telnyx) return false;
  return verifyTelnyxSignature({
    publicKey: telnyx.publicKey,
    signature: headerValue(headers['telnyx-signature-ed25519']),
    timestamp: headerValue(headers['telnyx-timestamp']),
    rawBody,
    toleranceSeconds: telnyx.signatureToleranceSeconds,
    now: deps.now(),
  });
}

function syntheticRaw(event: Record<string, unknown>): Uint8Array {
  return Buffer.from(JSON.stringify({ data: event }), 'utf8');
}

function payloadString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function clientState(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
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
      path: '/internal/channel/webhooks/telnyx/messaging',
      bodyMode: 'raw',
      maxBodyBytes: MAX_WEBHOOK_BYTES,
      handler: async (req, body) =>
        routeResult(await handleMessagingEvent(rawBytes(body), req.headers, fullDeps)),
    },
    {
      method: 'POST',
      path: '/internal/channel/webhooks/telnyx/voice',
      bodyMode: 'raw',
      maxBodyBytes: MAX_WEBHOOK_BYTES,
      handler: async (req, body) => {
        const rawBody = rawBytes(body);
        if (!verifyWebhookRequest(rawBody, req.headers, fullDeps)) {
          return result(401, { error: 'invalid_signature' });
        }
        const event = parseEvent(rawBody);
        if (!event) return result(400, { error: 'invalid_event' });
        queueMicrotask(() => {
          void handleVoiceEvent(event, fullDeps).catch((error: unknown) => {
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
          syntheticRaw({
            id: `stub-message-${randomUUID()}`,
            event_type: 'message.received',
            occurred_at: fullDeps.now().toISOString(),
            record_type: 'event',
            payload: { from: { phone_number: from }, to: [], text },
          }),
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
        const callControlId = `stub-call-control-${randomUUID()}`;
        const occurredAt = fullDeps.now().toISOString();
        const voiceEvent = async (
          eventType: string,
          payload: Record<string, unknown>,
        ): Promise<void> => {
          const parsed = parseEvent(
            syntheticRaw({
              id: `stub-voice-${randomUUID()}`,
              event_type: eventType,
              occurred_at: occurredAt,
              record_type: 'event',
              payload,
            }),
          );
          if (!parsed) throw new Error('invalid synthetic voice event');
          await handleVoiceEvent(parsed, fullDeps);
        };
        await voiceEvent('call.initiated', {
          direction: 'incoming',
          from: e164,
          call_control_id: callControlId,
        });
        await voiceEvent('call.answered', { from: e164, call_control_id: callControlId });
        const hash = phoneHash(e164, fullDeps.config.vaultPepper, fullDeps.config.municipalityId);
        const link = (await fullDeps.store.listOpenLinks(hash))[0];
        if (link) {
          await voiceEvent('call.speak.ended', {
            call_control_id: callControlId,
            client_state: clientState({
              step: 'prompt',
              caseNumber: link.caseNumber,
              recordId: link.recordId,
            }),
          });
          await voiceEvent('call.recording.saved', {
            call_control_id: callControlId,
            recording_id: `stub-rec-${callControlId}`,
            recording_urls: { wav: `stub://recording/stub-rec-${callControlId}` },
            client_state: clientState({
              step: 'recording',
              caseNumber: link.caseNumber,
              recordId: link.recordId,
            }),
          });
        }
        return stubResponse(fullDeps, from, sentStart, commandStart);
      },
    },
  );
  return routes;
}

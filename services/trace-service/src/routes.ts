// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from 'node:http';
import { binaryResult, result, type HttpResult, type Route } from '@polis/service-runtime';

import { DomainError, requireRole, roleForActor } from './domain.js';
import { publicTraceConfig } from './config.js';
import type {
  Actor,
  AiDecisionInput,
  AiProposalInput,
  AttentionInput,
  CaseMessageDeliveryState,
  CloseInput,
  CommandContext,
  FilerMessageInput,
  GatewayCreateInput,
  GatewayMessageInput,
  OfficialMessageInput,
  TraceConfig,
  TraceStore,
} from './types.js';
import {
  InputError,
  normalizeAiDecision,
  normalizeAiProposal,
  normalizeAssign,
  normalizeAttachment,
  normalizeAttention,
  normalizeClose,
  normalizeCommitment,
  normalizeCreate,
  normalizeDelivery,
  normalizeFilerMessage,
  normalizeGatewayCreate,
  normalizeGatewayMessage,
  normalizeOfficialMessage,
  normalizeReopenRead,
  normalizeResolution,
  normalizeReview,
  parseListLimit,
  validateCaseNumber,
  validateIdempotencyKey,
  validateRecordId,
} from './validation.js';

const SERVICE = 'trace-service';

type RouteHandler = Route['handler'];

function safeError(error: unknown): HttpResult {
  if (error instanceof InputError || error instanceof DomainError) {
    return result(error.status, { error: error.code, message: error.message });
  }
  console.error(
    JSON.stringify({ service: SERVICE, stage: 'request', error: 'trace_operation_failed' }),
  );
  return result(500, { error: 'internal_error', message: 'The trace operation failed.' });
}

function safe(handler: RouteHandler): RouteHandler {
  return async (request, body, params) => {
    try {
      return await handler(request, body, params);
    } catch (error) {
      return safeError(error);
    }
  };
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function actorFromRequest(request: IncomingMessage, config: TraceConfig): Actor {
  const value = request.headers['x-polis-citizen'];
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || hasControl(value)) {
    throw new DomainError(401, 'authentication_required', 'Authentication is required.');
  }
  const id = value.trim();
  return { id, email: null, role: roleForActor(config, id) };
}
function gatewayActorFromRequest(request: IncomingMessage, config: TraceConfig): Actor {
  const citizen = request.headers['x-polis-citizen'];
  const value = request.headers['x-polis-trace-gateway'];
  if (
    citizen !== undefined ||
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    hasControl(value)
  ) {
    throw new DomainError(401, 'authentication_required', 'Authentication is required.');
  }
  const id = value.trim();
  if (!config.gatewayIds?.has(id)) {
    throw new DomainError(401, 'authentication_required', 'Authentication is required.');
  }
  return { id: `gateway:${id}`, email: null, role: 'gateway' };
}

function aiActorFromRequest(request: IncomingMessage, config: TraceConfig): Actor {
  if (
    request.headers['x-polis-trace-gateway'] !== undefined ||
    request.headers['x-polis-citizen'] !== undefined
  ) {
    return gatewayActorFromRequest(request, config);
  }
  return { id: 'internal:service', email: null, role: 'gateway' };
}

function requireOfficialOrReviewer(actor: Actor): void {
  if (actor.role !== 'official' && actor.role !== 'reviewer') {
    throw new DomainError(403, 'forbidden', 'This role cannot perform the requested action.');
  }
}

function readContext(
  actor: Actor,
  path: string,
  normalizedBody: Record<string, unknown> = {},
): CommandContext {
  return {
    actor,
    method: 'GET',
    path,
    idempotencyKey: '',
    normalizedBody,
  };
}

function commandContext(
  request: IncomingMessage,
  actor: Actor,
  path: string,
  normalizedBody: Record<string, unknown>,
): CommandContext {
  return {
    actor,
    method: 'POST',
    path,
    idempotencyKey: validateIdempotencyKey(request.headers['idempotency-key']),
    normalizedBody,
  };
}

function recordPath(id: string, suffix = ''): string {
  return `/internal/trace/records/${id}${suffix}`;
}

function attachmentDisposition(filename: string): string {
  const fallback = [...filename]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code > 126 || code === 34 || code === 92 ? '_' : character;
    })
    .join('');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function operationalRoutes(store: TraceStore): Route[] {
  const check = async (ready: boolean) => {
    try {
      await store.check();
      return result(200, { status: ready ? 'ready' : 'ok', service: SERVICE });
    } catch {
      return result(503, {
        status: ready ? 'not_ready' : 'not_healthy',
        service: SERVICE,
        dependency: 'database',
      });
    }
  };
  return [
    { method: 'GET', path: '/healthz', handler: () => check(false) },
    { method: 'GET', path: '/readyz', handler: () => check(true) },
  ];
}

export function traceRoutes(store: TraceStore, config: TraceConfig): Route[] {
  return [
    ...operationalRoutes(store),
    {
      method: 'GET',
      path: '/internal/trace/config',
      handler: () => publicTraceConfig(config),
    },
    {
      method: 'GET',
      path: '/internal/trace/session',
      handler: safe(async (request) => {
        const actor = actorFromRequest(request, config);
        return {
          actorId: actor.id,
          email: actor.email,
          role: actor.role,
          municipalityId: config.pilot.municipality.id,
        };
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/records',
      handler: safe(async (request) => {
        const actor = actorFromRequest(request, config);
        return { records: await store.listPrivate(actor, parseListLimit(request.url)) };
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records',
      maxBodyBytes: 20_000,
      handler: safe(async (request, body) => {
        const actor = actorFromRequest(request, config);
        const normalized = normalizeCreate(body);
        const ctx = commandContext(request, actor, '/internal/trace/records', normalized);
        const created = await store.create(ctx);
        return result(created.status, created.body);
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/records/:id',
      handler: safe(async (request, _body, params) => {
        const actor = actorFromRequest(request, config);
        const record = await store.getPrivate(actor, validateRecordId(params.id ?? ''));
        if (!record) throw new DomainError(404, 'record_not_found', 'Record not found.');
        return { record };
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/assign',
      maxBodyBytes: 2_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/assign'),
          normalizeAssign(body),
        );
        const output = await store.assign(ctx, id);
        return result(output.status, output.body);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/commitment',
      maxBodyBytes: 10_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/commitment'),
          normalizeCommitment(body),
        );
        const output = await store.commitment(ctx, id);
        return result(output.status, output.body);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/review',
      maxBodyBytes: 10_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/review'),
          normalizeReview(body),
        );
        const output = await store.review(ctx, id);
        return result(output.status, output.body);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/resolution',
      maxBodyBytes: 40_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/resolution'),
          normalizeResolution(body),
        );
        const output = await store.resolution(ctx, id);
        return result(output.status, output.body);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/resolution-review',
      maxBodyBytes: 10_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/resolution-review'),
          normalizeReview(body),
        );
        const output = await store.resolutionReview(ctx, id);
        return result(output.status, output.body);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/attachments',
      maxBodyBytes: 2_900_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/attachments'),
          normalizeAttachment(body),
        );
        const output = await store.addAttachment(ctx, id);
        return result(output.status, output.body);
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/records/:id/attachments/:attachmentId',
      handler: safe(async (request, _body, params) => {
        const actor = actorFromRequest(request, config);
        const recordId = validateRecordId(params.id ?? '');
        const attachmentId = validateRecordId(params.attachmentId ?? '');
        const attachment = await store.downloadAttachment(actor, recordId, attachmentId);
        if (!attachment)
          throw new DomainError(404, 'attachment_not_found', 'Attachment not found.');
        return binaryResult(200, attachment.bytes, attachment.contentType, {
          'cache-control': 'private, no-store',
          'content-disposition': attachmentDisposition(attachment.filename),
        });
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/public/records',
      handler: safe(async (request) => ({
        records: await store.listPublic(parseListLimit(request.url)),
      })),
    },
    {
      method: 'GET',
      path: '/internal/trace/public/records/:id',
      handler: safe(async (_request, _body, params) => {
        const record = await store.getPublic(validateRecordId(params.id ?? ''));
        if (!record)
          throw new DomainError(404, 'public_record_not_found', 'Published record not found.');
        return { record };
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/channel/cases',
      maxBodyBytes: 2_920_000,
      handler: safe(async (request, body) => {
        const actor = gatewayActorFromRequest(request, config);
        const normalized = normalizeGatewayCreate(body);
        const ctx = commandContext(request, actor, '/internal/trace/channel/cases', normalized);
        return result(
          201,
          await store.createChannelCase(ctx, normalized as unknown as GatewayCreateInput),
        );
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/channel/cases/:caseNumber/messages',
      maxBodyBytes: 20_000,
      handler: safe(async (request, body, params) => {
        const actor = gatewayActorFromRequest(request, config);
        const caseNumber = validateCaseNumber(params.caseNumber ?? '');
        const normalized = normalizeGatewayMessage(body);
        const ctx = commandContext(
          request,
          actor,
          `/internal/trace/channel/cases/${caseNumber}/messages`,
          normalized as unknown as Record<string, unknown>,
        );
        const { reopenKey: _reopenKey, ...input } = normalized;
        return result(
          201,
          await store.appendChannelMessage(
            ctx,
            caseNumber,
            input as unknown as GatewayMessageInput,
          ),
        );
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/channel/outbox',
      handler: safe(async (request) => {
        const actor = gatewayActorFromRequest(request, config);
        const limit = parseListLimit(request.url);
        return store.listOutbox(
          readContext(actor, '/internal/trace/channel/outbox', { limit }),
          limit,
        );
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/channel/outbox/:messageId/delivery',
      maxBodyBytes: 2_000,
      handler: safe(async (request, body, params) => {
        const actor = gatewayActorFromRequest(request, config);
        const messageId = validateRecordId(params.messageId ?? '');
        const normalized = normalizeDelivery(body);
        const ctx = commandContext(
          request,
          actor,
          `/internal/trace/channel/outbox/${messageId}/delivery`,
          normalized,
        );
        return store.markOutboxDelivery(
          ctx,
          messageId,
          normalized as unknown as {
            state: CaseMessageDeliveryState;
            failureCode?: string;
          },
        );
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/cases/:caseNumber/private',
      maxBodyBytes: 2_000,
      handler: safe(async (_request, body, params) => {
        const caseNumber = validateCaseNumber(params.caseNumber ?? '');
        const normalized = normalizeReopenRead(body);
        return store.readFilerCase(caseNumber, String(normalized.reopenKey));
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/cases/:caseNumber/messages',
      maxBodyBytes: 20_000,
      handler: safe(async (request, body, params) => {
        validateIdempotencyKey(request.headers['idempotency-key']);
        const caseNumber = validateCaseNumber(params.caseNumber ?? '');
        const normalized = normalizeFilerMessage(body);
        const { reopenKey, ...input } = normalized;
        return result(
          201,
          await store.appendFilerMessage(
            caseNumber,
            String(reopenKey),
            input as unknown as FilerMessageInput,
          ),
        );
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/records/:id/messages',
      handler: safe(async (request, _body, params) => {
        const actor = actorFromRequest(request, config);
        requireOfficialOrReviewer(actor);
        const id = validateRecordId(params.id ?? '');
        return store.listMessages(readContext(actor, recordPath(id, '/messages')), id);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/messages',
      maxBodyBytes: 20_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        requireRole(actor, 'official');
        const id = validateRecordId(params.id ?? '');
        const normalized = normalizeOfficialMessage(body);
        const ctx = commandContext(request, actor, recordPath(id, '/messages'), normalized);
        const { expectedVersion: _expectedVersion, ...input } = normalized;
        return result(
          201,
          await store.postOfficialMessage(ctx, id, input as unknown as OfficialMessageInput),
        );
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/ai-proposals',
      maxBodyBytes: 20_000,
      handler: safe(async (request, body, params) => {
        const actor = aiActorFromRequest(request, config);
        const id = validateRecordId(params.id ?? '');
        const normalized = normalizeAiProposal(body);
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/ai-proposals'),
          normalized as unknown as Record<string, unknown>,
        );
        return result(
          201,
          await store.proposeAi(ctx, id, normalized as unknown as AiProposalInput),
        );
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/ai-proposals/:proposalId/decision',
      maxBodyBytes: 10_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        requireOfficialOrReviewer(actor);
        const id = validateRecordId(params.id ?? '');
        const proposalId = validateRecordId(params.proposalId ?? '');
        const normalized = normalizeAiDecision(body);
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, `/ai-proposals/${proposalId}/decision`),
          normalized as unknown as Record<string, unknown>,
        );
        const { expectedVersion: _expectedVersion, ...input } = normalized;
        return store.decideAi(ctx, id, proposalId, input as unknown as AiDecisionInput);
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/records/:id/close',
      maxBodyBytes: 10_000,
      handler: safe(async (request, body, params) => {
        const actor = actorFromRequest(request, config);
        requireRole(actor, 'reviewer');
        const id = validateRecordId(params.id ?? '');
        const normalized = normalizeClose(body);
        const ctx = commandContext(
          request,
          actor,
          recordPath(id, '/close'),
          normalized as unknown as Record<string, unknown>,
        );
        const { expectedVersion: _expectedVersion, ...input } = normalized;
        return store.closeCase(ctx, id, input as unknown as CloseInput);
      }),
    },
    {
      method: 'GET',
      path: '/internal/trace/public/cases',
      handler: safe(async (request) => store.listPublicShells(parseListLimit(request.url))),
    },
    {
      method: 'GET',
      path: '/internal/trace/public/cases/:caseNumber',
      handler: safe(async (_request, _body, params) => {
        const found = await store.getPublicCase(validateCaseNumber(params.caseNumber ?? ''));
        if (!found) throw new DomainError(404, 'case_not_found', 'Case not found.');
        return found;
      }),
    },
    {
      method: 'POST',
      path: '/internal/trace/public/cases/:caseNumber/attention',
      maxBodyBytes: 2_000,
      handler: safe(async (request, body, params) => {
        validateIdempotencyKey(request.headers['idempotency-key']);
        const caseNumber = validateCaseNumber(params.caseNumber ?? '');
        return store.recordAttention(
          caseNumber,
          normalizeAttention(body) as unknown as AttentionInput,
        );
      }),
    },
  ];
}

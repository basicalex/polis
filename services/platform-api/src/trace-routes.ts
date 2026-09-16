// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IncomingMessage } from 'node:http';

import {
  binaryResult,
  fetchWithTimeout,
  internalHeaders,
  result,
  trustedActorHeaders,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import {
  hasAuthorityFields,
  hasTrustedEdgeHeaders,
  isAuthenticatedActor,
  requireCitizenResult,
  type AuthenticatedActor,
} from './auth.js';
import { parseInternalFetchTimeoutMs } from './config.js';
import { upstreamFailure } from './proxy.js';
import { createFixedWindowPerIpLimiter } from './public-edge.js';

const TRACE_PREFIX = '/api/trace';
const INTERNAL_TRACE_PREFIX = '/internal/trace';
const LIST_QUERY_PARAMETERS: Readonly<Record<string, true>> = { limit: true };
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTACHMENT_UPLOAD_MAX_BODY_BYTES = 2_900_000;
const MAX_WEB_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_WEB_PHOTO_BASE64_BYTES = Math.ceil(MAX_WEB_PHOTO_BYTES / 3) * 4;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * MINUTE_MS;
const AUTHORITY_FIELDS = [
  'actorId',
  'citizenId',
  'identityLevel',
  'role',
  'municipality',
  'municipalityId',
  'category',
  'categoryId',
  'office',
  'officeId',
  'assignedOffice',
  'assignedOfficeId',
  'residentId',
  'officialId',
  'reviewerId',
  'ownerId',
  'ownerActorId',
  'actorRole',
  'sessionToken',
  'token',
  'internalToken',
] as const;

type TraceBodyShapeResult =
  { body: Record<string, unknown>; error?: never } | { body?: never; error: HttpResult };

type TraceRouteSpec = {
  method: 'GET' | 'POST';
  path: string;
  access: 'public' | 'private';
  internalPath?: string;
  gatewayPrincipalEnv?: 'TRACE_WEB_GATEWAY_ACTOR_ID';
  shapeBody?: (body: unknown) => TraceBodyShapeResult;
  listQuery?: true;
  write?: true;
  maxBodyBytes?: number;
  rateLimit?: Readonly<{ limit: number; windowMs: number }>;
};

const TRACE_ROUTE_SPECS: readonly TraceRouteSpec[] = [
  { method: 'GET', path: '/config', access: 'public' },
  { method: 'GET', path: '/session', access: 'private' },
  { method: 'GET', path: '/records', access: 'private', listQuery: true },
  { method: 'POST', path: '/records', access: 'private', write: true },
  { method: 'GET', path: '/records/:id', access: 'private' },
  { method: 'POST', path: '/records/:id/assign', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/commitment', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/resolution', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/reopen', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/hold', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/release', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/label', access: 'private', write: true },
  {
    method: 'POST',
    path: '/records/:id/attachments',
    access: 'private',
    write: true,
    maxBodyBytes: ATTACHMENT_UPLOAD_MAX_BODY_BYTES,
  },
  {
    method: 'GET',
    path: '/records/:id/attachments/:attachmentId',
    access: 'private',
  },
  { method: 'GET', path: '/public/records', access: 'public', listQuery: true },
  { method: 'GET', path: '/public/records/:id', access: 'public' },
  { method: 'GET', path: '/public/cases', access: 'public', listQuery: true },
  {
    method: 'POST',
    path: '/public/cases',
    internalPath: '/channel/cases',
    access: 'public',
    gatewayPrincipalEnv: 'TRACE_WEB_GATEWAY_ACTOR_ID',
    shapeBody: shapeWebCaseBody,
    write: true,
    maxBodyBytes: ATTACHMENT_UPLOAD_MAX_BODY_BYTES,
    rateLimit: { limit: 5, windowMs: TEN_MINUTES_MS },
  },
  { method: 'GET', path: '/public/cases/:caseNumber', access: 'public' },
  {
    method: 'POST',
    path: '/public/cases/:caseNumber/attention',
    access: 'public',
    write: true,
    rateLimit: { limit: 30, windowMs: MINUTE_MS },
  },
  {
    method: 'POST',
    path: '/public/cases/:caseNumber/notice',
    access: 'public',
    write: true,
    rateLimit: { limit: 10, windowMs: TEN_MINUTES_MS },
  },
  {
    method: 'POST',
    path: '/cases/:caseNumber/dispute',
    access: 'public',
    write: true,
    rateLimit: { limit: 5, windowMs: TEN_MINUTES_MS },
  },
  {
    method: 'POST',
    path: '/cases/:caseNumber/erase-text',
    access: 'public',
    write: true,
    rateLimit: { limit: 5, windowMs: TEN_MINUTES_MS },
  },
  { method: 'POST', path: '/cases/:caseNumber/private', access: 'public' },
  {
    method: 'POST',
    path: '/cases/:caseNumber/messages',
    access: 'public',
    write: true,
  },
  { method: 'GET', path: '/records/:id/messages', access: 'private' },
  { method: 'POST', path: '/records/:id/messages', access: 'private', write: true },
  {
    method: 'POST',
    path: '/records/:id/ai-proposals/:proposalId/decision',
    access: 'private',
    write: true,
  },
  { method: 'POST', path: '/records/:id/close', access: 'private', write: true },
];

function configuredTraceBase(): string | null {
  const base = process.env.TRACE_INTERNAL_URL?.trim();
  const token = process.env.INTERNAL_API_TOKEN?.trim();
  return base && token ? base.replace(/\/+$/, '') : null;
}

function internalPath(path: string, params: Record<string, string>): string {
  return (
    INTERNAL_TRACE_PREFIX +
    path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_match, name: string) =>
      encodeURIComponent(params[name] ?? ''),
    )
  );
}

function listSearch(req: IncomingMessage): string {
  const input = new URL(req.url ?? '/', 'http://localhost');
  const output = new URLSearchParams();
  for (const [name, value] of input.searchParams) {
    if (LIST_QUERY_PARAMETERS[name]) output.append(name, value);
  }
  const query = output.toString();
  return query ? '?' + query : '';
}
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  authority_fields_forbidden: 'Identity and authority fields are server controlled.',
  bad_gateway: 'Trace service is unavailable.',
  identity_unavailable: 'Identity verification is unavailable.',
  idempotency_key_required: 'Idempotency-Key is required.',
  invalid_request: 'The request body is invalid.',
  invalid_idempotency_key: 'Idempotency-Key must be a UUID.',
  trace_unavailable: 'Trace service is unavailable.',
  rate_limited: 'Too many requests.',
  release_not_permitted: 'Text release is not permitted.',
  text_removed: 'Public text has been removed.',
  trusted_headers_forbidden: 'Trusted identity headers are not accepted from clients.',
  unauthenticated: 'Sign in is required.',
  upstream_error: 'Trace service returned an invalid response.',
  upstream_timeout: 'Trace service timed out.',
};

function traceError(status: number, error: string, message?: string): HttpResult {
  return result(status, {
    error,
    message: message ?? ERROR_MESSAGES[error] ?? 'Trace request failed.',
  });
}

function shapeWebCaseBody(value: unknown): TraceBodyShapeResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: traceError(400, 'invalid_request') };
  }
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).every((key) => key === 'text' || key === 'location' || key === 'photo')) {
    return {
      error: traceError(400, 'invalid_request', 'Only text, location, and photo are accepted.'),
    };
  }
  if (typeof input.text !== 'string') {
    return { error: traceError(400, 'invalid_request', 'text must be a string.') };
  }
  if ('location' in input && typeof input.location !== 'string') {
    return { error: traceError(400, 'invalid_request', 'location must be a string.') };
  }

  let attachment: Record<string, string> | null = null;
  if (input.photo !== undefined && input.photo !== null) {
    if (typeof input.photo !== 'object' || Array.isArray(input.photo)) {
      return { error: traceError(400, 'invalid_request', 'photo must be an object or null.') };
    }
    const photo = input.photo as Record<string, unknown>;
    const keys = Object.keys(photo);
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === 'contentType' || key === 'base64') ||
      (photo.contentType !== 'image/jpeg' && photo.contentType !== 'image/png') ||
      typeof photo.base64 !== 'string' ||
      photo.base64.length === 0 ||
      photo.base64.length > MAX_WEB_PHOTO_BASE64_BYTES ||
      !STANDARD_BASE64.test(photo.base64)
    ) {
      return { error: traceError(400, 'invalid_request', 'photo is invalid.') };
    }
    const padding = photo.base64.endsWith('==') ? 2 : photo.base64.endsWith('=') ? 1 : 0;
    const decodedSize = (photo.base64.length / 4) * 3 - padding;
    if (decodedSize > MAX_WEB_PHOTO_BYTES) {
      return { error: traceError(400, 'invalid_request', 'photo is invalid.') };
    }
    attachment = {
      filename: photo.contentType === 'image/jpeg' ? 'photo.jpg' : 'photo.png',
      contentType: photo.contentType,
      base64: photo.base64,
    };
  }

  return {
    body: {
      channel: 'web',
      text: input.text,
      ...('location' in input ? { location: input.location } : {}),
      source: 'typed',
      occurredAt: new Date().toISOString(),
      ...(attachment ? { attachment } : {}),
    },
  };
}

function normalizeAuthError(value: HttpResult): HttpResult {
  const body = value.body as { error?: unknown; message?: unknown };
  const error = typeof body?.error === 'string' ? body.error : 'unauthenticated';
  const message =
    typeof body?.message === 'string' && body.message.trim() ? body.message : undefined;
  return traceError(value.status, error, message);
}

function readIdempotencyKey(req: IncomingMessage): string | HttpResult {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || !value.trim()) {
    return traceError(400, 'idempotency_key_required');
  }
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return traceError(400, 'invalid_idempotency_key');
  }
  return key;
}

function attachmentHeaders(upstream: Response): Record<string, string> {
  const disposition = upstream.headers.get('content-disposition');
  return {
    'cache-control': 'no-store',
    ...(disposition ? { 'content-disposition': disposition } : {}),
  };
}

async function jsonTraceResponse(upstream: Response, bytes: Uint8Array): Promise<HttpResult> {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return traceError(502, 'bad_gateway');
  }
  if (upstream.status < 400) return result(upstream.status, body);
  if (!body || typeof body !== 'object') return traceError(upstream.status, 'upstream_error');
  const candidate = body as { error?: unknown; message?: unknown };
  const error = typeof candidate.error === 'string' ? candidate.error : 'upstream_error';
  const message =
    typeof candidate.message === 'string' && candidate.message.trim()
      ? candidate.message
      : undefined;
  return traceError(upstream.status, error, message);
}

async function proxyTrace(
  base: string,
  spec: TraceRouteSpec,
  req: IncomingMessage,
  params: Record<string, string>,
  actor: AuthenticatedActor | null,
  body: unknown,
  idempotencyKey: string | null,
  gatewayPrincipal: string | null,
): Promise<unknown> {
  const extraHeaders: Record<string, string> = {};
  if (idempotencyKey) extraHeaders['idempotency-key'] = idempotencyKey;
  if (gatewayPrincipal) extraHeaders['x-polis-trace-gateway'] = gatewayPrincipal;
  const headers = actor ? trustedActorHeaders(actor, extraHeaders) : internalHeaders(extraHeaders);
  const path =
    internalPath(spec.internalPath ?? spec.path, params) + (spec.listQuery ? listSearch(req) : '');
  try {
    const upstream = await fetchWithTimeout(
      base + path,
      {
        method: spec.method,
        headers,
        body: spec.method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      },
      parseInternalFetchTimeoutMs(),
    );
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') ?? '';
    if (contentType.toLowerCase().startsWith('application/json')) {
      return jsonTraceResponse(upstream, bytes);
    }
    const attachmentDownload =
      spec.method === 'GET' && spec.path === '/records/:id/attachments/:attachmentId';
    if (!attachmentDownload || upstream.status >= 400) return traceError(502, 'bad_gateway');
    return binaryResult(
      upstream.status,
      bytes,
      contentType || 'application/octet-stream',
      attachmentHeaders(upstream),
    );
  } catch (error) {
    const failure = upstreamFailure(error) as HttpResult;
    const body = failure.body as { error?: unknown };
    return traceError(failure.status, typeof body?.error === 'string' ? body.error : 'bad_gateway');
  }
}

/** Exact feature-gated platform routes for the isolated trace service. */
export function traceRoutes(): Route[] {
  if (process.env.TRACE_ENABLED !== 'true') return [];

  return TRACE_ROUTE_SPECS.map((spec) => {
    const allowRequest = spec.rateLimit
      ? createFixedWindowPerIpLimiter(spec.rateLimit.limit, spec.rateLimit.windowMs)
      : null;
    return {
      method: spec.method,
      path: TRACE_PREFIX + spec.path,
      ...(spec.maxBodyBytes ? { maxBodyBytes: spec.maxBodyBytes } : {}),
      handler: async (
        req: IncomingMessage,
        body: unknown,
        params: Record<string, string>,
      ): Promise<unknown> => {
        if (hasTrustedEdgeHeaders(req)) {
          return traceError(400, 'trusted_headers_forbidden');
        }

        let actor: AuthenticatedActor | null = null;
        if (spec.access === 'private') {
          const verified = await requireCitizenResult(req);
          if (!isAuthenticatedActor(verified)) return normalizeAuthError(verified);
          actor = verified;
        }

        if (spec.method === 'POST' && hasAuthorityFields(body, AUTHORITY_FIELDS)) {
          return traceError(400, 'authority_fields_forbidden');
        }

        let proxyBody = body;
        if (spec.shapeBody) {
          const shaped = spec.shapeBody(body);
          if (shaped.error) return shaped.error;
          proxyBody = shaped.body;
        }

        let gatewayPrincipal: string | null = null;
        if (spec.gatewayPrincipalEnv) {
          gatewayPrincipal = process.env[spec.gatewayPrincipalEnv]?.trim() || null;
          if (!gatewayPrincipal) return traceError(503, 'trace_unavailable');
        }

        let idempotencyKey: string | null = null;
        if (spec.write) {
          const parsed = readIdempotencyKey(req);
          if (typeof parsed !== 'string') return parsed;
          idempotencyKey = parsed;
        }
        if (allowRequest && !allowRequest(req)) return traceError(429, 'rate_limited');

        const base = configuredTraceBase();
        if (!base) return traceError(503, 'trace_unavailable');
        return proxyTrace(
          base,
          spec,
          req,
          params,
          actor,
          proxyBody,
          idempotencyKey,
          gatewayPrincipal,
        );
      },
    };
  });
}

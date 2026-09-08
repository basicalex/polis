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

const TRACE_PREFIX = '/api/trace';
const INTERNAL_TRACE_PREFIX = '/internal/trace';
const LIST_QUERY_PARAMETERS: Readonly<Record<string, true>> = { limit: true };
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTACHMENT_UPLOAD_MAX_BODY_BYTES = 2_900_000;
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

type TraceRouteSpec = {
  method: 'GET' | 'POST';
  path: string;
  access: 'public' | 'private';
  listQuery?: true;
  write?: true;
  maxBodyBytes?: number;
};

const TRACE_ROUTE_SPECS: readonly TraceRouteSpec[] = [
  { method: 'GET', path: '/config', access: 'public' },
  { method: 'GET', path: '/session', access: 'private' },
  { method: 'GET', path: '/records', access: 'private', listQuery: true },
  { method: 'POST', path: '/records', access: 'private', write: true },
  { method: 'GET', path: '/records/:id', access: 'private' },
  { method: 'POST', path: '/records/:id/assign', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/commitment', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/review', access: 'private', write: true },
  { method: 'POST', path: '/records/:id/resolution', access: 'private', write: true },
  {
    method: 'POST',
    path: '/records/:id/resolution-review',
    access: 'private',
    write: true,
  },
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
  invalid_idempotency_key: 'Idempotency-Key must be a UUID.',
  trace_unavailable: 'Trace service is unavailable.',
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
): Promise<unknown> {
  const extraHeaders: Record<string, string> = idempotencyKey
    ? { 'idempotency-key': idempotencyKey }
    : {};
  const headers = actor ? trustedActorHeaders(actor, extraHeaders) : internalHeaders(extraHeaders);
  const path = internalPath(spec.path, params) + (spec.listQuery ? listSearch(req) : '');
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

  return TRACE_ROUTE_SPECS.map((spec) => ({
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

      let idempotencyKey: string | null = null;
      if (spec.write) {
        const parsed = readIdempotencyKey(req);
        if (typeof parsed !== 'string') return parsed;
        idempotencyKey = parsed;
      }

      const base = configuredTraceBase();
      if (!base) return traceError(503, 'trace_unavailable');
      return proxyTrace(base, spec, req, params, actor, body, idempotencyKey);
    },
  }));
}

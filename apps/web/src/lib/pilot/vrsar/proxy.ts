// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

const SESSION_COOKIE = 'polis_pilot_session';
const LOCAL_BACKEND = 'http://127.0.0.1:3000';
const MAX_JSON_BYTES = 3 * 1024 * 1024;
const ID_SEGMENT = '[A-Za-z0-9_-]{1,128}';

interface ProxyContext {
  request: Request;
  url: URL;
  params: Record<string, string | undefined>;
}

interface ProxyOverrides {
  publicRelease?: boolean;
  backendBase?: string | null;
  fetchImpl?: typeof fetch;
}

interface RouteMatch {
  upstreamPath: string;
  needsSession: boolean;
  idempotency: boolean;
  responseKind: 'json' | 'attachment' | 'identity-session' | 'identity-authorize' | 'logout';
  bodyKeys?: readonly string[];
  upstreamBody?: Record<string, unknown>;
}

function jsonError(status: number, error: string, message: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify({ error, message }), { status, headers });
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export function resolvePilotBackend(
  requestUrl: URL,
  configured: string | null | undefined,
): string | null {
  const raw = configured?.trim();
  if (!raw) {
    return requestUrl.protocol === 'http:' && isLoopbackHostname(requestUrl.hostname)
      ? LOCAL_BACKEND
      : null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) return null;
  return url.origin;
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    try {
      const token = decodeURIComponent(rest.join('='));
      return token && token.length <= 8192 ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function shouldSecureSessionCookie(url: URL): boolean {
  return !(url.protocol === 'http:' && isLoopbackHostname(url.hostname));
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/pilot/vrsar; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/pilot/vrsar; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function validStableCode(value: unknown): string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : 'upstream_error';
}

function safeMessage(value: unknown): string {
  return typeof value === 'string' && value.length <= 500
    ? value
    : 'The test service could not complete the request.';
}

function exactBodyKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

async function readJsonBody(request: Request, allowed: readonly string[]): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return jsonError(415, 'invalid_request', 'This endpoint accepts JSON only.');
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    return jsonError(413, 'attachment_too_large', 'The request body exceeds the test limit.');
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonError(400, 'invalid_request', 'The request body could not be read.');
  }
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    return jsonError(413, 'attachment_too_large', 'The request body exceeds the test limit.');
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    return jsonError(400, 'invalid_request', 'The request body is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonError(400, 'invalid_request', 'The request body must be a JSON object.');
  }
  const body = parsed as Record<string, unknown>;
  if (!exactBodyKeys(body, allowed)) {
    return jsonError(400, 'invalid_request', 'The request contains unsupported fields.');
  }
  return body;
}

function matchTraceRoute(method: string, path: string): RouteMatch | null {
  const exact: Record<string, RouteMatch> = {
    'GET config': {
      upstreamPath: '/api/trace/config',
      needsSession: false,
      idempotency: false,
      responseKind: 'json',
    },
    'GET session': {
      upstreamPath: '/api/trace/session',
      needsSession: true,
      idempotency: false,
      responseKind: 'json',
    },
    'GET records': {
      upstreamPath: '/api/trace/records',
      needsSession: true,
      idempotency: false,
      responseKind: 'json',
    },
    'POST records': {
      upstreamPath: '/api/trace/records',
      needsSession: true,
      idempotency: true,
      responseKind: 'json',
      bodyKeys: ['subject', 'narrative', 'location', 'contactEmail'],
    },
    'GET public/records': {
      upstreamPath: '/api/trace/public/records',
      needsSession: false,
      idempotency: false,
      responseKind: 'json',
    },
    'POST identity/magic-link': {
      upstreamPath: '/api/v1/identity/magic-link',
      needsSession: false,
      idempotency: false,
      responseKind: 'json',
      bodyKeys: ['email'],
    },
    'POST identity/exchange': {
      upstreamPath: '/api/v1/identity/exchange',
      needsSession: false,
      idempotency: false,
      responseKind: 'identity-session',
      bodyKeys: ['email', 'token'],
    },
    'POST identity/logout': {
      upstreamPath: '/api/v1/identity/logout',
      needsSession: true,
      idempotency: false,
      responseKind: 'logout',
      bodyKeys: [],
    },
  };
  const direct = exact[`${method} ${path}`];
  if (direct) return direct;

  const privateDetail = path.match(new RegExp(`^records/(${ID_SEGMENT})$`));
  if (method === 'GET' && privateDetail) {
    return {
      upstreamPath: `/api/trace/records/${encodeURIComponent(privateDetail[1])}`,
      needsSession: true,
      idempotency: false,
      responseKind: 'json',
    };
  }

  const publicDetail = path.match(new RegExp(`^public/records/(${ID_SEGMENT})$`));
  if (method === 'GET' && publicDetail) {
    return {
      upstreamPath: `/api/trace/public/records/${encodeURIComponent(publicDetail[1])}`,
      needsSession: false,
      idempotency: false,
      responseKind: 'json',
    };
  }

  const attachmentDownload = path.match(
    new RegExp(`^records/(${ID_SEGMENT})/attachments/(${ID_SEGMENT})$`),
  );
  if (method === 'GET' && attachmentDownload) {
    return {
      upstreamPath: `/api/trace/records/${encodeURIComponent(attachmentDownload[1])}/attachments/${encodeURIComponent(attachmentDownload[2])}`,
      needsSession: true,
      idempotency: false,
      responseKind: 'attachment',
    };
  }

  const action = path.match(
    new RegExp(
      `^records/(${ID_SEGMENT})/(assign|commitment|review|resolution|resolution-review|attachments)$`,
    ),
  );
  if (method !== 'POST' || !action) return null;
  const bodyKeys: Record<string, readonly string[]> = {
    assign: ['expectedVersion'],
    commitment: ['expectedVersion', 'publicSummary', 'commitment', 'dueDate'],
    review: ['expectedVersion', 'decision', 'note'],
    resolution: ['expectedVersion', 'evidenceNote', 'evidenceUrls'],
    'resolution-review': ['expectedVersion', 'decision', 'note'],
    attachments: ['expectedVersion', 'filename', 'contentType', 'base64'],
  };
  return {
    upstreamPath: `/api/trace/records/${encodeURIComponent(action[1])}/${action[2]}`,
    needsSession: true,
    idempotency: true,
    responseKind: 'json',
    bodyKeys: bodyKeys[action[2]],
  };
}

function identityAuthorizeRoute(method: string, path: string, appOrigin: string): RouteMatch | null {
  if (method === 'GET' && path === 'identity/authorize') {
    const redirectUri = `${appOrigin}/pilot/vrsar/login`;
    return {
      upstreamPath: `/api/v1/identity/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
      needsSession: false,
      idempotency: false,
      responseKind: 'identity-authorize',
    };
  }
  if (method === 'POST' && path === 'identity/callback') {
    return {
      upstreamPath: '/api/v1/identity/callback',
      needsSession: false,
      idempotency: false,
      responseKind: 'identity-session',
      bodyKeys: ['code', 'state'],
      upstreamBody: { redirectUri: `${appOrigin}/pilot/vrsar/login` },
    };
  }
  return null;
}

function cleanProxyPath(raw: string | undefined): string | null {
  if (!raw || raw.length > 512 || raw.startsWith('/') || raw.endsWith('/') || raw.includes('//')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('?') || decoded.includes('#')) return null;
  return decoded;
}

async function upstreamJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function responseHeaders(): Headers {
  return new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
}

export async function handlePilotProxy(
  context: ProxyContext,
  overrides: ProxyOverrides = {},
): Promise<Response> {
  const publicRelease =
    overrides.publicRelease ??
    (typeof import.meta.env !== 'undefined' && import.meta.env.PUBLIC_RELEASE === '1');
  if (publicRelease) {
    return jsonError(404, 'pilot_not_available', 'This test workflow is not available.');
  }

  const path = cleanProxyPath(context.params.path);
  if (!path) return jsonError(404, 'not_found', 'Endpoint not found.');

  const method = context.request.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Method not allowed.', { allow: 'GET, POST' });
  }

  if (method === 'POST') {
    const origin = context.request.headers.get('origin');
    if (!origin || origin !== context.url.origin) {
      return jsonError(403, 'invalid_origin', 'Request origin does not match this application.');
    }
  }

  const route =
    matchTraceRoute(method, path) ?? identityAuthorizeRoute(method, path, context.url.origin);
  if (!route) return jsonError(404, 'not_found', 'Endpoint not found.');

  const configured =
    overrides.backendBase !== undefined ? overrides.backendBase : import.meta.env.PILOT_API_BASE;
  const backend = resolvePilotBackend(context.url, configured);
  if (!backend) {
    return jsonError(503, 'backend_not_configured', 'The pilot backend is not configured.');
  }

  const token = cookieValue(context.request);
  if (route.needsSession && !token) {
    return jsonError(401, 'unauthorized', 'Sign-in is required.');
  }

  let body: Record<string, unknown> | undefined;
  if (method === 'POST') {
    const emptyBodyAllowed = (route.bodyKeys?.length ?? 0) === 0;
    const hasJsonBody = context.request.headers.has('content-type');
    if (emptyBodyAllowed && !hasJsonBody) {
      body = route.upstreamBody ? { ...route.upstreamBody } : {};
    } else {
      const parsed = await readJsonBody(context.request, route.bodyKeys ?? []);
      if (parsed instanceof Response) return parsed;
      body = route.upstreamBody ? { ...parsed, ...route.upstreamBody } : parsed;
    }
  }

  const upstreamHeaders = new Headers({ accept: 'application/json' });
  if (method === 'POST') upstreamHeaders.set('content-type', 'application/json');
  if (route.needsSession && token) upstreamHeaders.set('authorization', `Bearer ${token}`);
  if (route.idempotency) {
    const key = context.request.headers.get('idempotency-key');
    if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      return jsonError(400, 'invalid_request', 'A valid idempotency key is required.');
    }
    upstreamHeaders.set('idempotency-key', key);
  }

  const fetchImpl = overrides.fetchImpl ?? fetch;
  let upstream: Response;
  try {
    upstream = await fetchImpl(new URL(route.upstreamPath, backend), {
      method,
      headers: upstreamHeaders,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    const headers = route.responseKind === 'logout'
      ? { 'set-cookie': clearSessionCookie(shouldSecureSessionCookie(context.url)) }
      : undefined;
    return jsonError(502, 'upstream_unavailable', 'The test service is unavailable.', headers);
  }

  if (route.responseKind === 'attachment') {
    if (!upstream.ok) {
      const error = await upstreamJson(upstream);
      return jsonError(upstream.status, validStableCode(error.error), safeMessage(error.message));
    }
    const headers = new Headers({
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': upstream.headers.get('content-disposition') || 'attachment',
      'x-content-type-options': 'nosniff',
    });
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const payload = await upstreamJson(upstream);
  const headers = responseHeaders();

  if (route.responseKind === 'logout') {
    headers.set('set-cookie', clearSessionCookie(shouldSecureSessionCookie(context.url)));
    if (!upstream.ok) {
      return new Response(
        JSON.stringify({ error: validStableCode(payload.error), message: safeMessage(payload.message) }),
        { status: upstream.status, headers },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: validStableCode(payload.error), message: safeMessage(payload.message) }),
      { status: upstream.status, headers },
    );
  }

  if (route.responseKind === 'identity-session') {
    const tokenValue = payload.sessionToken;
    if (typeof tokenValue !== 'string' || !tokenValue || tokenValue.length > 8192) {
      return jsonError(502, 'invalid_response', 'The identity service returned an invalid session.');
    }
    headers.set('set-cookie', sessionCookie(tokenValue, shouldSecureSessionCookie(context.url)));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (route.responseKind === 'identity-authorize') {
    const authorizationUrl = payload.authorizationUrl;
    if (typeof authorizationUrl !== 'string') {
      return jsonError(502, 'invalid_response', 'The identity provider URL is unavailable.');
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(authorizationUrl);
    } catch {
      return jsonError(502, 'invalid_response', 'The identity provider URL is invalid.');
    }
    if (
      parsedUrl.protocol !== 'https:' &&
      !(parsedUrl.protocol === 'http:' && isLoopbackHostname(parsedUrl.hostname))
    ) {
      return jsonError(502, 'invalid_response', 'The identity provider URL is not allowed.');
    }
    return new Response(JSON.stringify({ authorizationUrl: parsedUrl.toString() }), {
      status: upstream.status,
      headers,
    });
  }

  return new Response(JSON.stringify(payload), { status: upstream.status, headers });
}

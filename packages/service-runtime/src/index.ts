/**
 * @polis/service-runtime — minimal HTTP primitives for Polis Interface services.
 *
 * Owns the routing seam shared by every TS service. Routes may declare `:param`
 * path segments; `startService` matches method + path and extracts params.
 *
 * Operational endpoints (`/healthz`, `/readyz`, `/metrics`, `/version`) are the
 * only routes every service gets for free; domain routes are composed by the
 * service via {@link operationalRoutes} + its own `Route[]`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export type BodyMode = 'json' | 'raw' | 'none';

export type Route = {
  method: string;
  /** Path literal; `:name` segments are captured into handler params. */
  path: string;
  /** Defaults to `none` for GET/HEAD and `json` for all other methods. */
  bodyMode?: BodyMode;
  /** Per-route request cap; defaults to 5 MiB. */
  maxBodyBytes?: number;
  handler: (
    req: IncomingMessage,
    body: unknown,
    params: Record<string, string>,
  ) => unknown | Promise<unknown>;
};

/** Branded result so handlers can set a non-200 status without colliding with a
 * normal body that happens to have {status, body} keys. Build with {@link result}. */
const RESULT: unique symbol = Symbol('polis.httpResult');
export interface HttpResult {
  [RESULT]: true;
  status: number;
  body: unknown;
}
export const result = (status: number, body: unknown): HttpResult =>
  ({ [RESULT]: true, status, body }) as HttpResult;
const isHttpResult = (value: unknown): value is HttpResult =>
  typeof value === 'object' && value !== null && RESULT in value && value[RESULT] === true;

const BINARY_RESULT: unique symbol = Symbol('polis.binaryResult');
const SAFE_BINARY_HEADERS: Record<string, true> = {
  'cache-control': true,
  'content-disposition': true,
  'content-language': true,
  etag: true,
  expires: true,
  'last-modified': true,
};

export interface BinaryResult {
  [BINARY_RESULT]: true;
  status: number;
  bytes: Uint8Array;
  contentType: string;
  headers: Readonly<Record<string, string>>;
}

/** Build a binary response. Only inert representation/cache headers are emitted. */
export const binaryResult = (
  status: number,
  bytes: Uint8Array,
  contentType: string,
  headers: Readonly<Record<string, string>> = {},
): BinaryResult => ({ [BINARY_RESULT]: true, status, bytes, contentType, headers }) as BinaryResult;

const isBinaryResult = (value: unknown): value is BinaryResult =>
  typeof value === 'object' &&
  value !== null &&
  BINARY_RESULT in value &&
  value[BINARY_RESULT] === true;

export interface TrustedActor {
  citizenId: string;
  identityLevel: string;
}

function configuredInternalToken(): string {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) throw new Error('INTERNAL_API_TOKEN is required');
  return token;
}

/** Headers for authenticated service-to-service JSON requests. */
export function internalHeaders(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    ...extra,
    'content-type': 'application/json',
    'x-polis-internal-token': configuredInternalToken(),
  };
}

/** Internal request headers carrying a trusted actor identity. */
export function trustedActorHeaders(
  actor: TrustedActor,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...internalHeaders(extra),
    'x-polis-citizen': actor.citizenId,
    'x-polis-identity-level': actor.identityLevel,
  };
}

function hasValidInternalToken(value: string | string[] | undefined): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected || typeof value !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(value);
  const comparable =
    suppliedBytes.length === expectedBytes.length ? suppliedBytes : Buffer.alloc(expectedBytes.length);
  return timingSafeEqual(expectedBytes, comparable) && suppliedBytes.length === expectedBytes.length;
}

/** Build metadata exposed at `/version` (spec §27 source/build transparency). */
export interface VersionMeta {
  service: string;
  version: string;
  gitSha: string;
  buildTime: string;
  sourceUrl: string;
  environment: string;
}

const VERSION_FALLBACK = '0.1.0-v1';

export function versionMeta(service: string): VersionMeta {
  return {
    service,
    version: process.env.SERVICE_VERSION ?? VERSION_FALLBACK,
    gitSha: process.env.GIT_SHA ?? 'dev',
    buildTime: process.env.BUILD_TIME ?? '',
    sourceUrl: process.env.SOURCE_URL ?? '',
    environment: process.env.NODE_ENV ?? 'development',
  };
}

/** Send a JSON response with permissive CORS (public read API). */
export const json = (res: ServerResponse, status: number, value: unknown): void => {
  const text = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'access-control-allow-origin': '*',
  });
  res.end(text);
};

const DEFAULT_MAX_BODY_BYTES = 5_000_000;

export class BodyTooLargeError extends Error {
  readonly status = 413;

  constructor(readonly maxBodyBytes: number) {
    super(`body exceeds ${maxBodyBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** Read a bounded request body; JSON mode keeps empty → `{}` and invalid JSON compatibility. */
export const readBody = (
  req: IncomingMessage,
  bodyMode: BodyMode = 'json',
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> => {
  if (bodyMode === 'none') return Promise.resolve({});
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maxBodyBytes) {
        settled = true;
        reject(new BodyTooLargeError(maxBodyBytes));
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const data = Buffer.concat(chunks, size);
      if (bodyMode === 'raw') return resolve(data);
      if (data.byteLength === 0) return resolve({});
      const text = data.toString('utf8');
      try {
        return resolve(JSON.parse(text));
      } catch {
        return resolve({ raw: text });
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
};

/** The four operational routes every service exposes. */
export function operationalRoutes(service: string): Route[] {
  return [
    {
      method: 'GET',
      path: '/healthz',
      handler: () => ({ status: 'ok', service }),
    },
    {
      method: 'GET',
      path: '/readyz',
      handler: () => ({ status: 'ready', service }),
    },
    {
      method: 'GET',
      path: '/metrics',
      handler: () => `polis_service_up{service="${service}"} 1\n`,
    },
    {
      method: 'GET',
      path: '/version',
      handler: () => versionMeta(service),
    },
  ];
}

/** Match a route path literal against an actual pathname, extracting params. */
function matchPath(routePath: string, actualPath: string): Record<string, string> | null {
  const r = routePath.split('/').filter(Boolean);
  const a = actualPath.split('/').filter(Boolean);
  if (r.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < r.length; i++) {
    const seg = r[i];
    if (!seg) continue;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(a[i] ?? '');
    else if (seg !== a[i]) return null;
  }
  return params;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,idempotency-key',
};

/**
 * Start an HTTP service. `routes` is the full route table; callers compose
 * {@link operationalRoutes} with their domain routes.
 */
export function startService(service: string, port: number, routes: Route[]): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (
      url.pathname.startsWith('/internal/') &&
      !hasValidInternalToken(req.headers['x-polis-internal-token'])
    ) {
      return json(res, 401, { error: 'internal_auth_required', service });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
    let matched: { route: Route; params: Record<string, string> } | undefined;
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params) {
        matched = { route, params };
        break;
      }
    }
    if (!matched) {
      return json(res, 404, { error: 'not_found', service, path: url.pathname });
    }
    try {
      const bodyMode =
        matched.route.bodyMode ??
        (req.method === 'GET' || req.method === 'HEAD' ? 'none' : 'json');
      const body = await readBody(req, bodyMode, matched.route.maxBodyBytes);
      const out = await matched.route.handler(req, body, matched.params);
      if (isHttpResult(out)) {
        return json(res, out.status, out.body);
      }
      if (isBinaryResult(out)) {
        const headers: Record<string, string | number> = {
          'content-type': out.contentType,
          'content-length': out.bytes.byteLength,
          'access-control-allow-origin': '*',
        };
        for (const [name, value] of Object.entries(out.headers)) {
          const normalizedName = name.toLowerCase();
          if (SAFE_BINARY_HEADERS[normalizedName]) headers[normalizedName] = value;
        }
        res.writeHead(out.status, headers);
        return res.end(out.bytes);
      }
      if (typeof out === 'string') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(out);
      }
      return json(res, 200, out);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return json(res, 413, { error: 'body_too_large', service });
      }
      const cause =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack ?? null }
          : { name: 'UnknownError', message: String(error), stack: null };
      console.error(JSON.stringify({ service, stage: 'request', error: cause }));
      return json(res, 500, { error: 'internal_error', service });
    }
  });
  server.listen(port);
  return server;
}

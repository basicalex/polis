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
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { validateRuntimeConfig, type RuntimeConfig } from './config.js';

export * from './config.js';
export * from './http-client.js';

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
export function internalHeaders(
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
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
    suppliedBytes.length === expectedBytes.length
      ? suppliedBytes
      : Buffer.alloc(expectedBytes.length);
  return (
    timingSafeEqual(expectedBytes, comparable) && suppliedBytes.length === expectedBytes.length
  );
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

export interface ResponseOptions {
  requestOrigin?: string;
  corsAllowedOrigins?: readonly string[];
}

const SAFE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function responseHeaders(options: ResponseOptions = {}): Record<string, string> {
  const origins =
    options.corsAllowedOrigins ?? validateRuntimeConfig(process.env).corsAllowedOrigins;
  const headers: Record<string, string> = { ...SAFE_RESPONSE_HEADERS };
  if (origins.length === 1 && origins[0] === '*') {
    headers['access-control-allow-origin'] = '*';
  } else {
    headers.vary = 'Origin';
    if (options.requestOrigin && origins.includes(options.requestOrigin)) {
      headers['access-control-allow-origin'] = options.requestOrigin;
    }
  }
  return headers;
}

/** Send a JSON response with safe defaults and the configured CORS policy. */
export const json = (
  res: ServerResponse,
  status: number,
  value: unknown,
  options: ResponseOptions = {},
): void => {
  const text = JSON.stringify(value);
  res.writeHead(status, {
    ...responseHeaders(options),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
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
        req.pause();
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

export interface ReadinessStatus {
  ready: boolean;
  dependency?: string;
}

export type ReadinessCheck = () => boolean | ReadinessStatus | Promise<boolean | ReadinessStatus>;
export type ReadinessSource = ReadinessController | ReadinessCheck;

function safeDependencyLabel(label: string | undefined): string {
  return label && /^[a-zA-Z0-9_.-]{1,64}$/.test(label) ? label : 'dependency';
}

export class ReadinessController {
  #status: ReadinessStatus;

  constructor(ready = true, dependency?: string) {
    this.#status = ready
      ? { ready: true }
      : { ready: false, dependency: safeDependencyLabel(dependency) };
  }

  setReady(): void {
    this.#status = { ready: true };
  }

  setNotReady(dependency = 'dependency'): void {
    this.#status = { ready: false, dependency: safeDependencyLabel(dependency) };
  }

  check(): ReadinessStatus {
    return { ...this.#status };
  }
}

async function readinessStatus(source: ReadinessSource): Promise<ReadinessStatus> {
  try {
    const value = source instanceof ReadinessController ? source.check() : await source();
    if (typeof value === 'boolean') {
      return value ? { ready: true } : { ready: false, dependency: 'dependency' };
    }
    return value.ready
      ? { ready: true }
      : { ready: false, dependency: safeDependencyLabel(value.dependency) };
  } catch {
    return { ready: false, dependency: 'dependency' };
  }
}

const ALWAYS_READY: ReadinessCheck = () => true;
const REQUEST_READINESS: unique symbol = Symbol('polis.requestReadiness');
interface RuntimeIncomingMessage extends IncomingMessage {
  [REQUEST_READINESS]?: ReadinessSource;
}

/** The four operational routes every service exposes. */
export function operationalRoutes(
  service: string,
  readiness: ReadinessSource = ALWAYS_READY,
): Route[] {
  return [
    {
      method: 'GET',
      path: '/healthz',
      handler: () => ({ status: 'ok', service }),
    },
    {
      method: 'GET',
      path: '/readyz',
      handler: async (req) => {
        const requestReadiness = (req as RuntimeIncomingMessage)[REQUEST_READINESS];
        const status = await readinessStatus(requestReadiness ?? readiness);
        return status.ready
          ? result(200, { status: 'ready', service })
          : result(503, {
              status: 'not_ready',
              service,
              dependency: safeDependencyLabel(status.dependency),
            });
      },
    },
    {
      method: 'GET',
      path: '/metrics',
      handler: async (req) => {
        const requestReadiness = (req as RuntimeIncomingMessage)[REQUEST_READINESS];
        const status = await readinessStatus(requestReadiness ?? readiness);
        return (
          `polis_service_up{service="${service}"} 1\n` +
          `polis_service_ready{service="${service}"} ${status.ready ? 1 : 0}\n`
        );
      },
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

const CORS_PREFLIGHT_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,idempotency-key',
};

export interface StartServiceOptions {
  readiness?: ReadinessSource;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  maxRequestsPerSocket?: number;
  shutdownGraceMs?: number;
  validateConfig?: () => void;
}

interface ManagedServer {
  server: Server;
  readiness: ReadinessSource | undefined;
  shutdownGraceMs: number;
  draining: boolean;
  forceCloseTimer?: NodeJS.Timeout;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEADERS_TIMEOUT_MS = 10_000;
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REQUESTS_PER_SOCKET = 1_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
const MAX_SERVER_TIMEOUT_MS = 300_000;
const managedServers = new Set<ManagedServer>();
let signalHandlersInstalled = false;

function checkedInteger(name: string, value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function beginDrain(managed: ManagedServer): void {
  if (managed.draining) {
    managed.server.closeAllConnections();
    return;
  }
  managed.draining = true;
  if (managed.readiness instanceof ReadinessController) {
    managed.readiness.setNotReady('shutdown');
  }
  managed.server.close();
  managed.server.closeIdleConnections();
  managed.forceCloseTimer = setTimeout(() => {
    managed.server.closeAllConnections();
  }, managed.shutdownGraceMs);
  managed.forceCloseTimer.unref();
}

function drainAllServers(): void {
  for (const managed of managedServers) beginDrain(managed);
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  process.on('SIGTERM', drainAllServers);
  process.on('SIGINT', drainAllServers);
  signalHandlersInstalled = true;
}

function removeSignalHandlersIfUnused(): void {
  if (!signalHandlersInstalled || managedServers.size !== 0) return;
  process.off('SIGTERM', drainAllServers);
  process.off('SIGINT', drainAllServers);
  signalHandlersInstalled = false;
}

function manageServer(
  server: Server,
  readiness: ReadinessSource | undefined,
  shutdownGraceMs: number,
): void {
  const managed: ManagedServer = { server, readiness, shutdownGraceMs, draining: false };
  managedServers.add(managed);
  installSignalHandlers();
  server.once('close', () => {
    clearTimeout(managed.forceCloseTimer);
    managedServers.delete(managed);
    removeSignalHandlersIfUnused();
  });
}

function requestResponseOptions(req: IncomingMessage, config: RuntimeConfig): ResponseOptions {
  const requestOrigin = req.headers.origin;
  return {
    corsAllowedOrigins: config.corsAllowedOrigins,
    ...(typeof requestOrigin === 'string' ? { requestOrigin } : {}),
  };
}

/**
 * Start an HTTP service. `routes` is the full route table; callers compose
 * {@link operationalRoutes} with their domain routes.
 */
export function startService(
  service: string,
  port: number,
  routes: Route[],
  options: StartServiceOptions = {},
): Server {
  const config = validateRuntimeConfig(process.env);
  options.validateConfig?.();
  const requestTimeoutMs = checkedInteger(
    'requestTimeoutMs',
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_SERVER_TIMEOUT_MS,
  );
  const headersTimeoutMs = checkedInteger(
    'headersTimeoutMs',
    options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS,
    MAX_SERVER_TIMEOUT_MS,
  );
  const keepAliveTimeoutMs = checkedInteger(
    'keepAliveTimeoutMs',
    options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
    MAX_SERVER_TIMEOUT_MS,
  );
  const maxRequestsPerSocket = checkedInteger(
    'maxRequestsPerSocket',
    options.maxRequestsPerSocket ?? DEFAULT_MAX_REQUESTS_PER_SOCKET,
    1_000_000,
  );
  const shutdownGraceMs = checkedInteger(
    'shutdownGraceMs',
    options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
    MAX_SERVER_TIMEOUT_MS,
  );

  const server = createServer(async (req, res) => {
    if (options.readiness) {
      (req as RuntimeIncomingMessage)[REQUEST_READINESS] = options.readiness;
    }
    const responseOptions = requestResponseOptions(req, config);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const internalToken = req.headers['x-polis-internal-token'];
    const citizenId = req.headers['x-polis-citizen'];
    const identityLevel = req.headers['x-polis-identity-level'];
    const carriesAuthorityHeaders =
      internalToken !== undefined || citizenId !== undefined || identityLevel !== undefined;
    const internalPath = url.pathname.startsWith('/internal/');
    if ((internalPath || carriesAuthorityHeaders) && !hasValidInternalToken(internalToken)) {
      return json(res, 401, { error: 'internal_auth_required', service }, responseOptions);
    }
    const carriesActor = citizenId !== undefined || identityLevel !== undefined;
    if (
      carriesActor &&
      (typeof citizenId !== 'string' ||
        !citizenId.trim() ||
        typeof identityLevel !== 'string' ||
        !identityLevel.trim())
    ) {
      return json(res, 401, { error: 'trusted_actor_required', service }, responseOptions);
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...responseHeaders(responseOptions),
        ...CORS_PREFLIGHT_HEADERS,
      });
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
      return json(res, 404, { error: 'not_found', service, path: url.pathname }, responseOptions);
    }
    try {
      const bodyMode =
        matched.route.bodyMode ?? (req.method === 'GET' || req.method === 'HEAD' ? 'none' : 'json');
      const body = await readBody(req, bodyMode, matched.route.maxBodyBytes);
      const out = await matched.route.handler(req, body, matched.params);
      if (isHttpResult(out)) {
        return json(res, out.status, out.body, responseOptions);
      }
      if (isBinaryResult(out)) {
        const headers: Record<string, string | number> = {
          ...responseHeaders(responseOptions),
          'content-type': out.contentType,
          'content-length': out.bytes.byteLength,
        };
        for (const [name, value] of Object.entries(out.headers)) {
          const normalizedName = name.toLowerCase();
          if (SAFE_BINARY_HEADERS[normalizedName]) headers[normalizedName] = value;
        }
        res.writeHead(out.status, headers);
        return res.end(out.bytes);
      }
      if (typeof out === 'string') {
        res.writeHead(200, {
          ...responseHeaders(responseOptions),
          'content-type': 'text/plain; charset=utf-8',
        });
        return res.end(out);
      }
      return json(res, 200, out, responseOptions);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        res.once('finish', () => {
          if (!req.destroyed) req.destroy();
        });
        return json(res, 413, { error: 'body_too_large', service }, responseOptions);
      }
      const cause =
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack ?? null }
          : { name: 'UnknownError', message: String(error), stack: null };
      console.error(JSON.stringify({ service, stage: 'request', error: cause }));
      return json(res, 500, { error: 'internal_error', service }, responseOptions);
    }
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.maxRequestsPerSocket = maxRequestsPerSocket;
  server.listen(port);
  manageServer(server, options.readiness, shutdownGraceMs);
  return server;
}

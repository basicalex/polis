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

export type Route = {
  method: string;
  /** Path literal; `:name` segments are captured into handler params. */
  path: string;
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
const isHttpResult = (v: unknown): v is HttpResult =>
  typeof v === 'object' && v !== null && (v as { [RESULT]?: boolean })[RESULT] === true;

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

/** Read and JSON-parse a request body (5 MiB cap; empty → `{}`). */
export const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise<unknown>((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString('utf8');
      if (data.length > 5_000_000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) resolve({});
      else {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      }
    });
    req.on('error', reject);
  });

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
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

/**
 * Start an HTTP service. `routes` is the full route table; callers compose
 * {@link operationalRoutes} with their domain routes.
 */
export function startService(service: string, port: number, routes: Route[]): Server {
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
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
      const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req);
      const out = await matched.route.handler(req, body, matched.params);
      if (isHttpResult(out)) {
        return json(res, out.status, out.body);
      }
      if (typeof out === 'string') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(out);
      }
      return json(res, 200, out);
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : 'unknown', service });
    }
  });
  server.listen(port);
  return server;
}

import type { IncomingMessage } from 'node:http';

import { result, type Route } from '@polis/service-runtime';

/**
 * §23 public-edge hardening — when PUBLIC_EDGE=true, the BFF serves only reads
 * + exact stateless self-verification routes. An explicit allowlist blocks every
 * unlisted route, including future additions, and permitted traffic is rate-limited by IP.
 * When PUBLIC_EDGE is unset (dev), withPublicEdge is the identity function.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT = Number(process.env.PUBLIC_EDGE_RATE_LIMIT_PER_MIN ?? 60);
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

/** Fixed-window per-IP rate limit (single-instance v1; see plan Assumptions). */
function allowRequest(req: IncomingMessage): boolean {
  const key = req.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    bucket = { count: RATE_LIMIT, windowStart: now };
    rateBuckets.set(key, bucket);
  }
  bucket.count -= 1;
  return bucket.count >= 0;
}

/** Exact routes permitted by the isolated public-read pilot. Unknown routes fail closed. */
const PUBLIC_EDGE_ALLOWED: Record<string, true> = {
  'GET /healthz': true,
  'GET /readyz': true,
  'GET /metrics': true,
  'GET /version': true,
  'GET /api/v1/jurisdictions': true,
  'GET /api/v1/institutions': true,
  'GET /api/v1/institutions/:id': true,
  'GET /api/v1/roles/:id': true,
  'GET /api/v1/processes': true,
  'GET /api/v1/processes/:id': true,
  'GET /api/v1/document-types/:id': true,
  'GET /api/v1/laws/:id': true,
  'GET /api/v1/budget-lines/:id': true,
  'GET /api/v1/failure-modes': true,
  'GET /api/v1/controls': true,
  'GET /api/v1/proposals/:id': true,
  'GET /api/v1/assessments/:id': true,
  'GET /api/v1/claims': true,
  'GET /api/v1/claims/:id': true,
  'GET /api/v1/relationships': true,
  'GET /api/v1/graph/traverse': true,
  'GET /api/v1/mandate-holders': true,
  'GET /api/v1/mandate-holders/:id': true,
  'GET /api/v1/mandate-holders/:id/scorecard': true,
  'GET /api/v1/commitments/:id': true,
  'GET /api/v1/commitments/:id/questions': true,
  'GET /api/v1/issues': true,
  'GET /api/v1/issues/:id': true,
  'GET /api/v1/processes/:id/issues': true,
  'GET /api/v1/issues/:id/conversation': true,
  'GET /api/v1/audit/:objectType/:objectId': true,
  'GET /api/v1/proofs/:id': true,
  'GET /api/v1/proofs/:id/status': true,
  'GET /api/v1/proofs/:id/audit': true,
  'GET /api/v1/issuers/:id': true,
  'POST /api/v1/verify/file': true,
  'POST /api/v1/verify/hash': true,
  'POST /api/v1/verify/manifest': true,
  'GET /api/v1/pilot/charter': true,
  'GET /api/v1/pilot/results': true,
};

/** Operational routes exempt from rate-limiting so health checks pass. */
const PUBLIC_EDGE_RATE_EXEMPT: Record<string, true> = {
  'GET /healthz': true,
  'GET /readyz': true,
  'GET /metrics': true,
  'GET /version': true,
};

/**
 * Compose the isolated public-read route table. No-op unless PUBLIC_EDGE='true'.
 * - exact allowlist miss → pure 405 method_not_allowed (public_edge)
 * - operational routes → unchanged (exempt from rate-limit)
 * - permitted public routes → wrapped with a per-IP rate limit
 */
export function withPublicEdge(routes: Route[]): Route[] {
  if (process.env.PUBLIC_EDGE !== 'true') return routes;
  return routes.map((route) => {
    const routeKey = `${route.method} ${route.path}`;
    if (!PUBLIC_EDGE_ALLOWED[routeKey]) {
      return {
        ...route,
        handler: () => result(405, { error: 'method_not_allowed', reason: 'public_edge' }),
      };
    }
    if (PUBLIC_EDGE_RATE_EXEMPT[routeKey]) return route;
    const inner = route.handler;
    return {
      ...route,
      handler: async (
        req: IncomingMessage,
        body: unknown,
        params: Record<string, string>,
      ): Promise<unknown> => {
        if (!allowRequest(req)) return result(429, { error: 'rate_limited' });
        return inner(req, body, params);
      },
    };
  });
}

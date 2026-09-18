// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, timingSafeEqual } from 'node:crypto';
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

function headerValue(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function secretsEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

/** Derive the rate-limit key without trusting browser-supplied forwarding headers. */
export function clientAddressKey(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trustedKey = env.PUBLIC_EDGE_TRUSTED_KEY?.trim();
  const suppliedKey = headerValue(req, 'x-polis-edge-key');
  const suppliedClientIp = headerValue(req, 'x-polis-client-ip');
  if (
    trustedKey &&
    suppliedKey &&
    suppliedClientIp &&
    secretsEqual(suppliedKey, trustedKey)
  ) {
    return suppliedClientIp;
  }

  if (env.PUBLIC_EDGE_TRUST_XFF === 'true') {
    const forwarded = headerValue(req, 'x-forwarded-for')?.split(',', 1)[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/** Build a fixed-window, per-IP limiter for one route or route group. */
export function createFixedWindowPerIpLimiter(
  limit: number,
  windowMs: number,
): (req: IncomingMessage) => boolean {
  const rateBuckets = new Map<string, { count: number; windowStart: number }>();
  let nextSweep = 0;
  return (req) => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [address, bucket] of rateBuckets) {
        if (now - bucket.windowStart >= windowMs) rateBuckets.delete(address);
      }
      nextSweep = now + windowMs;
    }

    const key = clientAddressKey(req);
    let bucket = rateBuckets.get(key);
    if (!bucket) {
      bucket = { count: limit, windowStart: now };
      rateBuckets.set(key, bucket);
    }
    bucket.count -= 1;
    return bucket.count >= 0;
  };
}

const allowPublicEdgeRequest = createFixedWindowPerIpLimiter(RATE_LIMIT, RATE_LIMIT_WINDOW_MS);

// Infobip webhook ingress routes intentionally stay off this public-read allowlist.
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
  'GET /api/trace/config': true,
  'GET /api/trace/public/records': true,
  'GET /api/trace/public/records/:id': true,
  'GET /api/trace/public/cases': true,
  'GET /api/trace/public/summary': true,
  'GET /api/trace/officials/me': true,
  'POST /api/trace/public/cases': true,
  'GET /api/trace/public/cases/:caseNumber': true,
  'POST /api/trace/public/cases/:caseNumber/attention': true,
  'POST /api/trace/public/cases/:caseNumber/notice': true,
  'POST /api/trace/cases/:caseNumber/dispute': true,
  'POST /api/trace/cases/:caseNumber/erase-text': true,
  'POST /api/trace/cases/:caseNumber/private': true,
  'POST /api/trace/cases/:caseNumber/messages': true,
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
        if (!allowPublicEdgeRequest(req)) return result(429, { error: 'rate_limited' });
        return inner(req, body, params);
      },
    };
  });
}

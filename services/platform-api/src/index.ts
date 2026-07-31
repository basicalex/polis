/**
 * @polis/platform-api — the single public BFF edge (spec §23).
 *
 * Proxies public §23 reads to internal services and keeps the Phase 0
 * proof-hash verifier until the dedicated verifier service arrives.
 */
import type { IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runMigrationsOnce } from '@polis/db';
import {
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  trustedActorHeaders,
  type Route,
} from '@polis/service-runtime';

const repoRoot = resolve(import.meta.dirname, '../../..');

interface AuthenticatedActor {
  citizenId: string;
  identityLevel: string;
}
async function proxyTo(base: string, req: IncomingMessage, body?: unknown): Promise<unknown> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const hasBody = req.method !== 'GET' && body !== undefined;
    const upstream = await fetch(base + url.pathname + url.search, {
      method: req.method,
      headers: internalHeaders(),
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    if (!upstream.ok) {
      return result(
        upstream.status,
        await upstream.json().catch(() => ({ error: 'upstream_error' })),
      );
    }

    return result(upstream.status, await upstream.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return result(502, { error: 'bad_gateway', detail: message });
  }
}

async function proxyToPath(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  try {
    const hasBody = method !== 'GET' && body !== undefined;
    const upstream = await fetch(base + path, {
      method,
      headers: internalHeaders(),
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    if (!upstream.ok) {
      return result(
        upstream.status,
        await upstream.json().catch(() => ({ error: 'upstream_error' })),
      );
    }
    return result(upstream.status, await upstream.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return result(502, { error: 'bad_gateway', detail: message });
  }
}

const graphReadPaths = [
  '/api/v1/jurisdictions',
  '/api/v1/institutions',
  '/api/v1/institutions/:id',
  '/api/v1/roles/:id',
  '/api/v1/processes',
  '/api/v1/processes/:id',
  '/api/v1/document-types/:id',
  '/api/v1/laws/:id',
  '/api/v1/budget-lines/:id',
  '/api/v1/failure-modes',
  '/api/v1/controls',
  '/api/v1/proposals/:id',
  '/api/v1/assessments/:id',
  '/api/v1/claims',
  '/api/v1/claims/:id',
  '/api/v1/relationships',
  '/api/v1/graph/traverse',
  '/api/v1/mandate-holders',
  '/api/v1/mandate-holders/:id',
  '/api/v1/mandate-holders/:id/scorecard',
  '/api/v1/commitments/:id',
  '/api/v1/commitments/:id/questions',
] as const;

const polisReadPaths = [
  '/api/v1/issues',
  '/api/v1/issues/:id',
  '/api/v1/processes/:id/issues',
  '/api/v1/issues/:id/conversation',
] as const;

const proofReadPaths = [
  '/api/v1/proofs/:id',
  '/api/v1/proofs/:id/status',
  '/api/v1/proofs/:id/audit',
  '/api/v1/issuers/:id',
] as const;
const proofVerifyPaths = [
  '/api/v1/verify/file',
  '/api/v1/verify/hash',
  '/api/v1/verify/manifest',
] as const;
/** Verify a session token against citizen-identity-service. Fail closed. */
async function verifySession(sessionToken: string): Promise<AuthenticatedActor | null> {
  const base = process.env.IDENTITY_INTERNAL_URL ?? 'http://localhost:8650';
  try {
    const r = await fetch(base + '/internal/identity/verify-session', {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ sessionToken }),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { citizenId?: unknown; identityLevel?: unknown };
    return typeof body.citizenId === 'string' && typeof body.identityLevel === 'string'
      ? { citizenId: body.citizenId, identityLevel: body.identityLevel }
      : null;
  } catch {
    return null;
  }
}

/** Read and verify the bearer session, returning the full trusted actor. */
async function requireCitizen(req: IncomingMessage): Promise<AuthenticatedActor | null> {
  const auth = req.headers['authorization'];
  if (typeof auth !== 'string') return null;
  const [scheme, token] = auth.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return verifySession(token);
}

/**
 * Proxy to an explicit internal path with X-Polis-Citizen header injected.
 * Maps BFF public paths to service internal paths (e.g. /api/v1/vault/...
 * → /internal/vault/...). The removed proxyWithCitizen used same-path and
 * would 404 since services serve /internal/*.
 */
async function proxyToPathWithCitizen(
  base: string,
  method: string,
  internalPath: string,
  actor: AuthenticatedActor,
  body?: unknown,
): Promise<unknown> {
  try {
    const hasBody = method !== 'GET' && body !== undefined;
    const upstream = await fetch(base + internalPath, {
      method,
      headers: trustedActorHeaders(actor),
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    if (!upstream.ok) {
      return result(
        upstream.status,
        await upstream.json().catch(() => ({ error: 'upstream_error' })),
      );
    }
    return result(upstream.status, await upstream.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return result(502, { error: 'bad_gateway', detail: message });
  }
}

/**
 * §23 public-edge hardening — when PUBLIC_EDGE=true, the BFF serves only reads
 * + stateless self-verification (verify/hash|file|manifest), blocks every
 * write/login/participation route + the dev-token route, and rate-limits by IP.
 * When PUBLIC_EDGE is unset (dev), withPublicEdge is the identity function,
 * so behaviour is byte-identical to today and pnpm verify is unaffected.
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

/** Routes blocked on the public edge (write/login/participation + dev-tokens). */
const PUBLIC_EDGE_BLOCKED = new Set<string>([
  'POST /api/v1/assistant/ask',
  'POST /api/v1/assistant/outputs/:id/review',
  'POST /api/v1/contribute/evidence',
  'POST /api/v1/contribute/graph-edit',
  'POST /api/v1/review/:id/decide',
  'POST /api/v1/identity/magic-link',
  'POST /api/v1/identity/exchange',
  'GET /api/v1/identity/authorize',
  'POST /api/v1/identity/callback',
  'GET /api/v1/identity/dev-tokens',
  'POST /api/v1/mandate-holders/:id/charter-signing-requests',
  'GET /api/v1/mandate-holders/:id/charter-signing-status',
  'POST /api/v1/signing-requests/:id/stub-complete',
  'POST /webhooks/documenso',
  'POST /api/v1/vault/documents',
  'POST /api/v1/vault/grants',
  'POST /api/v1/vault/verify',
  'DELETE /api/v1/vault/grants/:id',
  'POST /api/v1/mandate-holders/:id/commitments',
  'POST /api/v1/commitments/:id/resolutions',
  'POST /api/v1/commitments/:id/questions',
  'POST /api/v1/commitment-questions/:id/answers',
]);

/** Operational routes exempt from rate-limiting so health checks pass. */
const PUBLIC_EDGE_RATE_EXEMPT = new Set<string>(['/healthz', '/readyz', '/metrics', '/version']);

/**
 * Compose a route table for the public edge. No-op unless PUBLIC_EDGE='true'.
 * - blocked routes → 405 method_not_allowed (public_edge)
 * - operational routes → unchanged (exempt from rate-limit)
 * - everything else → wrapped with a per-IP rate limit (429 when exhausted)
 */
export function withPublicEdge(routes: Route[]): Route[] {
  if (process.env.PUBLIC_EDGE !== 'true') return routes;
  return routes.map((route) => {
    const routeKey = `${route.method} ${route.path}`;
    if (PUBLIC_EDGE_BLOCKED.has(routeKey)) {
      return {
        ...route,
        handler: () => result(405, { error: 'method_not_allowed', reason: 'public_edge' }),
      };
    }
    if (PUBLIC_EDGE_RATE_EXEMPT.has(route.path)) return route;
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

export function platformRoutes(): Route[] {
  const graphBase = process.env.GRAPH_INTERNAL_URL ?? 'http://localhost:8100';
  const auditBase = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  const polisBase = process.env.POLIS_INTERNAL_URL ?? 'http://localhost:8200';
  const proofBase = process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700';
  const aiBase = process.env.AI_INTERNAL_URL ?? 'http://localhost:8550';
  const contributionBase = process.env.CONTRIBUTION_INTERNAL_URL ?? 'http://localhost:8450';
  const rewardsBase = process.env.REWARDS_INTERNAL_URL ?? 'http://localhost:8460';
  const identityBase = process.env.IDENTITY_INTERNAL_URL ?? 'http://localhost:8650';
  const vaultBase = process.env.VAULT_INTERNAL_URL ?? 'http://localhost:8750';
  const vcIssuerBase = process.env.VC_ISSUER_INTERNAL_URL ?? 'http://localhost:8950';

  const signingBase = process.env.SIGNING_INTERNAL_URL ?? 'http://localhost:8960';
  return [
    ...operationalRoutes('platform-api'),
    ...graphReadPaths.map((path) => ({
      method: 'GET',
      path,
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(graphBase, req, body),
    })),
    ...polisReadPaths.map((path) => ({
      method: 'GET',
      path,
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(polisBase, req, body),
    })),
    {
      method: 'GET',
      path: '/api/v1/audit/:objectType/:objectId',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(auditBase, req, body),
    },
    ...proofReadPaths.map((path) => ({
      method: 'GET',
      path,
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(proofBase, req, body),
    })),
    ...proofVerifyPaths.map((path) => ({
      method: 'POST',
      path,
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(proofBase, req, body),
    })),
    {
      method: 'POST',
      path: '/api/v1/assistant/ask',
      handler: async (_req: IncomingMessage, body: unknown) =>
        proxyToPath(aiBase, 'POST', '/internal/ai/answer', body),
    },
    {
      method: 'GET',
      path: '/api/v1/assistant/traces',
      handler: async () => proxyToPath(aiBase, 'GET', '/internal/ai/traces'),
    },
    {
      method: 'GET',
      path: '/api/v1/assistant/traces/:id',
      handler: async (_req: IncomingMessage, _body: unknown, params: Record<string, string>) =>
        proxyToPath(aiBase, 'GET', '/internal/ai/traces/' + params.id),
    },
    {
      method: 'GET',
      path: '/api/v1/assistant/outputs/:id',
      handler: async (_req: IncomingMessage, _body: unknown, params: Record<string, string>) =>
        proxyToPath(aiBase, 'GET', '/internal/ai/outputs/' + params.id),
    },
    {
      method: 'POST',
      path: '/api/v1/assistant/outputs/:id/review',
      handler: async (_req: IncomingMessage, body: unknown, params: Record<string, string>) =>
        proxyToPath(aiBase, 'POST', '/internal/ai/outputs/' + params.id + '/review', body),
    },
    // Public contribution routes — same-path proxy (contribution-service serves these paths).
    {
      method: 'POST',
      path: '/api/v1/contribute/evidence',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(contributionBase, req, body),
    },
    {
      method: 'POST',
      path: '/api/v1/contribute/graph-edit',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(contributionBase, req, body),
    },
    {
      method: 'GET',
      path: '/api/v1/contributions/:id',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(contributionBase, req, body),
    },
    {
      method: 'GET',
      path: '/api/v1/contributors/:id',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(contributionBase, req, body),
    },
    // Staff-only review routes. Reviewer identity comes only from the trusted actor.
    {
      method: 'GET',
      path: '/api/v1/review/queue',
      handler: async (req: IncomingMessage) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        if (actor.identityLevel !== 'staff') return result(403, { error: 'staff_required' });
        return proxyToPathWithCitizen(contributionBase, 'GET', '/internal/review/queue', actor);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/review/:id/decide',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        if (actor.identityLevel !== 'staff') return result(403, { error: 'staff_required' });
        const input = (body ?? {}) as { decision?: unknown; notes?: unknown };
        const forwarded: { decision?: unknown; notes?: unknown } = {};
        if ('decision' in input) forwarded.decision = input.decision;
        if ('notes' in input) forwarded.notes = input.notes;
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/internal/review/' + params.id + '/decide',
          actor,
          forwarded,
        );
      },
    },
    // §30.8 public rewards routes — same-path proxy (rewards-service serves these paths).
    // Payout details stay private: NO public /api/v1/rewards/payouts* route exists
    // (acceptance: GET /api/v1/rewards/payouts via BFF → 404).
    {
      method: 'GET',
      path: '/api/v1/rewards/rules',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(rewardsBase, req, body),
    },
    {
      method: 'GET',
      path: '/api/v1/rewards/public-ledger',
      handler: async (req: IncomingMessage, body: unknown) => proxyTo(rewardsBase, req, body),
    },
    // §30.9 / §21 public identity routes — login (no citizen session required).
    // Map /api/v1/identity/* → /internal/identity/* on identity-service.
    {
      method: 'POST',
      path: '/api/v1/identity/magic-link',
      handler: async (_req: IncomingMessage, body: unknown) =>
        proxyToPath(identityBase, 'POST', '/internal/identity/magic-link', body),
    },
    {
      method: 'POST',
      path: '/api/v1/identity/exchange',
      handler: async (_req: IncomingMessage, body: unknown) =>
        proxyToPath(identityBase, 'POST', '/internal/identity/exchange', body),
    },
    // M10 OIDC authorize — GET carries redirect_uri as a query param, so forward
    // url.search alongside the remapped internal path (identity-service serves
    // /internal/*, not /api/v1/* — a plain same-path proxy would 404 upstream).
    {
      method: 'GET',
      path: '/api/v1/identity/authorize',
      handler: async (req: IncomingMessage) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        return proxyToPath(identityBase, 'GET', '/internal/identity/authorize' + url.search);
      },
    },
    // M10 OIDC callback — POST carries code/state/redirectUri in the body.
    {
      method: 'POST',
      path: '/api/v1/identity/callback',
      handler: async (_req: IncomingMessage, body: unknown) =>
        proxyToPath(identityBase, 'POST', '/internal/identity/callback', body),
    },
    // Dev-only: surface magic tokens so the vault UI + acceptance can complete
    // login without SMTP. Gated by IDENTITY_DEV_TOKENS on identity-service (404 otherwise).
    {
      method: 'GET',
      path: '/api/v1/identity/dev-tokens',
      handler: async () => proxyToPath(identityBase, 'GET', '/internal/identity/dev-tokens'),
    },
    // §30.9 / §16 public-authenticated vault routes (requireCitizen → X-Polis-Citizen).
    // Map /api/v1/vault/* → /internal/vault/* on vault-service.
    {
      method: 'GET',
      path: '/api/v1/vault/documents',
      handler: async (req: IncomingMessage, _body: unknown) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(vaultBase, 'GET', '/internal/vault/documents', citizenId);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/vault/documents',
      handler: async (req: IncomingMessage, body: unknown) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          vaultBase,
          'POST',
          '/internal/vault/documents',
          citizenId,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/vault/grants',
      handler: async (req: IncomingMessage, body: unknown) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(vaultBase, 'POST', '/internal/vault/grants', citizenId, body);
      },
    },
    {
      method: 'DELETE',
      path: '/api/v1/vault/grants/:id',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          vaultBase,
          'DELETE',
          '/internal/vault/grants/' + params.id,
          citizenId,
          body,
        );
      },
    },
    {
      method: 'GET',
      path: '/api/v1/vault/access-events',
      handler: async (req: IncomingMessage, _body: unknown) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(vaultBase, 'GET', '/internal/vault/access-events', citizenId);
      },
    },
    // §30.9 grantee verify — grant-scoped, no citizen session (grant IS the credential).
    // Map /api/v1/vault/verify → /internal/vault/verify on vault-service.
    {
      method: 'POST',
      path: '/api/v1/vault/verify',
      handler: async (_req: IncomingMessage, body: unknown) =>
        proxyToPath(vaultBase, 'POST', '/internal/vault/verify', body),
    },
    // §15 VC lookup — public (grantee presents a VC; verifier checks the VC).
    // Map /api/v1/vc/:id → /internal/vc/:id on vc-issuer-service.
    {
      method: 'GET',
      path: '/api/v1/vc/:id',
      handler: async (_req: IncomingMessage, _body: unknown, params: Record<string, string>) =>
        proxyToPath(vcIssuerBase, 'GET', '/internal/vc/' + params.id),
    },
    // M-RA Phase 2 — citizen-authenticated mandate filings (requireCitizen → X-Polis-Citizen).
    // Map /api/v1/mandate-holders/:id/commitments → /internal/mandate-holders/:id/commitments
    //     /api/v1/commitments/:id/resolutions      → /internal/commitments/:id/resolutions
    {
      method: 'POST',
      path: '/api/v1/mandate-holders/:id/commitments',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/internal/mandate-holders/' + params.id + '/commitments',
          citizenId,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/commitments/:id/resolutions',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/internal/commitments/' + params.id + '/resolutions',
          citizenId,
          body,
        );
      },
    },
    // M-RA Phase 3 — citizen-authenticated Q&A (requireCitizen → X-Polis-Citizen).
    // Map /api/v1/commitments/:id/questions            → /internal/commitments/:id/questions
    //     /api/v1/commitment-questions/:id/answers     → /internal/commitment-questions/:id/answers
    {
      method: 'POST',
      path: '/api/v1/commitments/:id/questions',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/internal/commitments/' + params.id + '/questions',
          citizenId,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/commitment-questions/:id/answers',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const citizenId = await requireCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/internal/commitment-questions/' + params.id + '/answers',
          citizenId,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/mandate-holders/:id/charter-signing-requests',
      handler: async (req: IncomingMessage, _body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        const idempotencyKey = req.headers['idempotency-key'];
        if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
          return result(400, { error: 'idempotency_key_required' });
        }
        return proxyToPathWithCitizen(
          signingBase,
          'POST',
          '/internal/signing/charter-requests',
          actor,
          { mandateHolderId: params.id, idempotencyKey },
        );
      },
    },
    {
      method: 'GET',
      path: '/api/v1/mandate-holders/:id/charter-signing-status',
      handler: async (req: IncomingMessage, _body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          signingBase,
          'GET',
          '/internal/signing/charter-status/' + params.id,
          actor,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/signing-requests/:id/stub-complete',
      handler: async (req: IncomingMessage, _body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          signingBase,
          'POST',
          '/internal/signing/requests/' + params.id + '/stub-complete',
          actor,
        );
      },
    },
    {
      method: 'POST',
      path: '/webhooks/documenso',
      bodyMode: 'raw',
      maxBodyBytes: 1_000_000,
      handler: async (req: IncomingMessage, body: unknown) => {
        try {
          const secret = req.headers['x-documenso-secret'];
          const headers =
            typeof secret === 'string'
              ? internalHeaders({ 'x-documenso-secret': secret })
              : internalHeaders();
          const upstream = await fetch(signingBase + '/internal/signing/webhooks/documenso', {
            method: 'POST',
            headers,
            body: Buffer.from(body instanceof Uint8Array ? body : new Uint8Array()),
          });
          return result(
            upstream.status,
            await upstream.json().catch(() => ({ error: 'upstream_error' })),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown';
          return result(502, { error: 'bad_gateway', detail: message });
        }
      },
    },
    // M9 — pilot charter + results (static JSON files, no upstream service).
    {
      method: 'GET',
      path: '/api/v1/pilot/charter',
      handler: async () => {
        const raw = await readFile(resolve(repoRoot, 'data/pilot/charter.json'), 'utf8');
        return result(200, JSON.parse(raw));
      },
    },
    {
      method: 'GET',
      path: '/api/v1/pilot/results',
      handler: async () => {
        const raw = await readFile(resolve(repoRoot, 'data/pilot/results.json'), 'utf8');
        return result(200, JSON.parse(raw));
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.PLATFORM_API_PORT ?? 8080);
  // Keep a missing development database non-fatal while still migrating when available.
  try {
    await runMigrationsOnce();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error(
      JSON.stringify({ service: 'platform-api', stage: 'db-migrate', warning: message }),
    );
  }
  startService('platform-api', port, withPublicEdge(platformRoutes()));
  console.log(JSON.stringify({ service: 'platform-api', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

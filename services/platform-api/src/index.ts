/**
 * @polis/platform-api — the single public BFF edge (spec §23).
 *
 * Proxies public §23 reads to internal services and keeps the Phase 0
 * proof-hash verifier until the dedicated verifier service arrives.
 */
import type { IncomingMessage } from 'node:http';

import { runMigrationsOnce } from '@polis/db';
import { operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

async function proxyTo(base: string, req: IncomingMessage, body?: unknown): Promise<unknown> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const hasBody = req.method !== 'GET' && body !== undefined;
    const upstream = await fetch(base + url.pathname + url.search, {
      method: req.method,
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
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
export function platformRoutes(): Route[] {
  const graphBase = process.env.GRAPH_INTERNAL_URL ?? 'http://localhost:8100';
  const auditBase = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  const polisBase = process.env.POLIS_INTERNAL_URL ?? 'http://localhost:8200';
  const proofBase = process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700';
  const aiBase = process.env.AI_INTERNAL_URL ?? 'http://localhost:8550';
  const contributionBase = process.env.CONTRIBUTION_INTERNAL_URL ?? 'http://localhost:8450';
  const rewardsBase = process.env.REWARDS_INTERNAL_URL ?? 'http://localhost:8460';

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
    // Admin review routes — map public path → internal path (mirrors assistant outputs review).
    {
      method: 'GET',
      path: '/api/v1/review/queue',
      handler: async () => proxyToPath(contributionBase, 'GET', '/internal/review/queue'),
    },
    {
      method: 'POST',
      path: '/api/v1/review/:id/decide',
      handler: async (_req: IncomingMessage, body: unknown, params: Record<string, string>) =>
        proxyToPath(contributionBase, 'POST', '/internal/review/' + params.id + '/decide', body),
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
  startService('platform-api', port, platformRoutes());
  console.log(JSON.stringify({ service: 'platform-api', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

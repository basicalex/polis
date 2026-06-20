/**
 * @polis/platform-api — the single public BFF edge (spec §23).
 *
 * Proxies public §23 reads to internal services and keeps the Phase 0
 * proof-hash verifier until the dedicated verifier service arrives.
 */
import type { IncomingMessage } from 'node:http';

import { runMigrationsOnce } from '@polis/db';
import { createProofManifest, sha256Hex, verifyProof } from '@polis/domain';
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

    return await upstream.json();
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

export function platformRoutes(): Route[] {
  const graphBase = process.env.GRAPH_INTERNAL_URL ?? 'http://localhost:8100';
  const auditBase = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  const polisBase = process.env.POLIS_INTERNAL_URL ?? 'http://localhost:8200';

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
    // §23.5 verifier — hash proof (re-uses @polis/domain; replaced by §15 at M3)
    {
      method: 'POST',
      path: '/api/v1/verify/hash',
      handler: async (_req, body) => {
        const content = String((body as { content?: string }).content ?? '');
        const manifest = await createProofManifest(content);
        return verifyProof(manifest, await sha256Hex(content));
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
  startService('platform-api', port, platformRoutes());
  console.log(JSON.stringify({ service: 'platform-api', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

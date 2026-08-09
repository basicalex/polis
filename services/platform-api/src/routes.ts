import type { IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  fetchWithTimeout,
  internalHeaders,
  operationalRoutes,
  result,
  type Route,
} from '@polis/service-runtime';

import {
  hasAuthorityFields,
  hasTrustedEdgeHeaders,
  isAuthenticatedActor,
  proxyToPathWithCitizen,
  requireCitizen,
  requireCitizenResult,
  requireStaff,
} from './auth.js';
import { parseInternalFetchTimeoutMs } from './config.js';
import { proxyTo, proxyToPath, upstreamFailure } from './proxy.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

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
  const complaintsBase = process.env.COMPLAINTS_INTERNAL_URL ?? 'http://localhost:8970';
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
      handler: async (req: IncomingMessage) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(aiBase, 'GET', '/internal/ai/traces', actor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/assistant/traces/:id',
      handler: async (req: IncomingMessage, _body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(aiBase, 'GET', '/internal/ai/traces/' + params.id, actor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/assistant/outputs/:id',
      handler: async (req: IncomingMessage, _body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(aiBase, 'GET', '/internal/ai/outputs/' + params.id, actor);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/assistant/outputs/:id/review',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        const staffActor = actor;
        const input = (body ?? {}) as { decision?: unknown; notes?: unknown };
        const forwarded: { decision?: unknown; notes?: unknown; reviewerId: string } = {
          reviewerId: staffActor.citizenId,
        };
        if ('decision' in input) forwarded.decision = input.decision;
        if ('notes' in input) forwarded.notes = input.notes;
        return proxyToPathWithCitizen(
          aiBase,
          'POST',
          '/internal/ai/outputs/' + params.id + '/review',
          staffActor,
          forwarded,
        );
      },
    },
    // Contribution writes require a verified session and regenerate trusted actor headers.
    {
      method: 'POST',
      path: '/api/v1/contribute/evidence',
      handler: async (req: IncomingMessage, body: unknown) => {
        if (hasTrustedEdgeHeaders(req)) {
          return result(400, { error: 'trusted_headers_forbidden' });
        }
        if (
          hasAuthorityFields(body, ['contributor', 'contributorId', 'reviewerId', 'reviewerRole'])
        ) {
          return result(400, { error: 'authority_fields_forbidden' });
        }
        const actor = await requireCitizenResult(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/api/v1/contribute/evidence',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/contribute/graph-edit',
      handler: async (req: IncomingMessage, body: unknown) => {
        if (hasTrustedEdgeHeaders(req)) {
          return result(400, { error: 'trusted_headers_forbidden' });
        }
        if (
          hasAuthorityFields(body, ['contributor', 'contributorId', 'reviewerId', 'reviewerRole'])
        ) {
          return result(400, { error: 'authority_fields_forbidden' });
        }
        const actor = await requireCitizenResult(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          contributionBase,
          'POST',
          '/api/v1/contribute/graph-edit',
          actor,
          body,
        );
      },
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
    // The edge checks session staff status; contribution-service owns the DB-backed right.
    {
      method: 'GET',
      path: '/api/v1/review/queue',
      handler: async (req: IncomingMessage) => {
        if (hasTrustedEdgeHeaders(req)) {
          return result(400, { error: 'trusted_headers_forbidden' });
        }
        const actor = await requireCitizenResult(req);
        if (!isAuthenticatedActor(actor)) return actor;
        if (actor.identityLevel !== 'staff') return result(403, { error: 'staff_required' });
        return proxyToPathWithCitizen(contributionBase, 'GET', '/internal/review/queue', actor);
      },
    },
    {
      method: 'POST',
      path: '/api/v1/review/:id/decide',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        if (hasTrustedEdgeHeaders(req)) {
          return result(400, { error: 'trusted_headers_forbidden' });
        }
        if (hasAuthorityFields(body, ['reviewerId', 'reviewerRole'])) {
          return result(400, { error: 'authority_fields_forbidden' });
        }
        const actor = await requireCitizenResult(req);
        if (!isAuthenticatedActor(actor)) return actor;
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
    // Authenticated complaints routes. Trusted actor headers come only from the verified session.
    {
      method: 'POST',
      path: '/api/v1/complaints',
      handler: async (req: IncomingMessage, body: unknown) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(complaintsBase, 'POST', '/internal/complaints', actor, body);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/complaints/mine',
      handler: async (req: IncomingMessage) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(complaintsBase, 'GET', '/internal/complaints/mine', actor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/complaints/queue',
      handler: async (req: IncomingMessage) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(complaintsBase, 'GET', '/internal/complaints/queue', actor);
      },
    },
    {
      method: 'GET',
      path: '/api/v1/complaints/:id',
      handler: async (req: IncomingMessage, _body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          complaintsBase,
          'GET',
          '/internal/complaints/' + params.id,
          actor,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/assign',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' + params.id + '/assign',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/information-requests',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' + params.id + '/information-requests',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/information-requests/:requestId/respond',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' +
            params.id +
            '/information-requests/' +
            params.requestId +
            '/respond',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/decisions',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' + params.id + '/decisions',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/appeals',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireCitizen(req);
        if (!actor) return result(401, { error: 'unauthenticated' });
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' + params.id + '/appeals',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/appeals/:appealId/decisions',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' + params.id + '/appeals/' + params.appealId + '/decisions',
          actor,
          body,
        );
      },
    },
    {
      method: 'POST',
      path: '/api/v1/complaints/:id/close',
      handler: async (req: IncomingMessage, body: unknown, params: Record<string, string>) => {
        const actor = await requireStaff(req);
        if (!isAuthenticatedActor(actor)) return actor;
        return proxyToPathWithCitizen(
          complaintsBase,
          'POST',
          '/internal/complaints/' + params.id + '/close',
          actor,
          body,
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
          const upstream = await fetchWithTimeout(
            signingBase + '/internal/signing/webhooks/documenso',
            {
              method: 'POST',
              headers,
              body: Buffer.from(body instanceof Uint8Array ? body : new Uint8Array()),
            },
            parseInternalFetchTimeoutMs(),
          );
          return result(
            upstream.status,
            await upstream.json().catch(() => ({ error: 'upstream_error' })),
          );
        } catch (error) {
          return upstreamFailure(error);
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

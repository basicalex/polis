import type { IncomingMessage } from 'node:http';

import {
  fetchWithTimeout,
  internalHeaders,
  result,
  trustedActorHeaders,
  type HttpResult,
} from '@polis/service-runtime';

import { parseInternalFetchTimeoutMs } from './config.js';
import { upstreamFailure } from './proxy.js';

export interface AuthenticatedActor {
  citizenId: string;
  identityLevel: string;
}

type SessionVerification =
  | { status: 'verified'; actor: AuthenticatedActor }
  | { status: 'invalid' }
  | { status: 'unavailable' };

/** Verify a session token against citizen-identity-service without conflating invalid auth with outage. */
async function verifySession(sessionToken: string): Promise<SessionVerification> {
  const base = process.env.IDENTITY_INTERNAL_URL ?? 'http://localhost:8650';
  try {
    const response = await fetchWithTimeout(
      base + '/internal/identity/verify-session',
      {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({ sessionToken }),
      },
      parseInternalFetchTimeoutMs(),
    );
    if (response.status === 401 || response.status === 403) return { status: 'invalid' };
    if (!response.ok) return { status: 'unavailable' };
    const body = (await response.json()) as { citizenId?: unknown; identityLevel?: unknown };
    if (
      typeof body.citizenId !== 'string' ||
      !body.citizenId.trim() ||
      typeof body.identityLevel !== 'string' ||
      !body.identityLevel.trim()
    ) {
      return { status: 'unavailable' };
    }
    return {
      status: 'verified',
      actor: { citizenId: body.citizenId, identityLevel: body.identityLevel },
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Read and verify the bearer session, preserving verifier availability failures. */
export async function requireCitizenResult(
  req: IncomingMessage,
): Promise<AuthenticatedActor | HttpResult> {
  const auth = req.headers['authorization'];
  if (typeof auth !== 'string') return result(401, { error: 'unauthenticated' });
  const [scheme, token] = auth.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return result(401, { error: 'unauthenticated' });
  }
  const verification = await verifySession(token);
  if (verification.status === 'invalid') return result(401, { error: 'unauthenticated' });
  if (verification.status === 'unavailable') return result(503, { error: 'identity_unavailable' });
  return verification.actor;
}

/** Compatibility path for existing routes that still expose only authenticated/unauthenticated. */
export async function requireCitizen(req: IncomingMessage): Promise<AuthenticatedActor | null> {
  const actor = await requireCitizenResult(req);
  return isAuthenticatedActor(actor) ? actor : null;
}

export async function requireStaff(req: IncomingMessage): Promise<AuthenticatedActor | unknown> {
  const actor = await requireCitizen(req);
  if (!actor) return result(401, { error: 'unauthenticated' });
  if (actor.identityLevel !== 'staff') return result(403, { error: 'staff_required' });
  return actor;
}

export function isAuthenticatedActor(value: unknown): value is AuthenticatedActor {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as AuthenticatedActor).citizenId === 'string' &&
    typeof (value as AuthenticatedActor).identityLevel === 'string'
  );
}

const TRUSTED_EDGE_HEADERS = [
  'x-polis-citizen',
  'x-polis-identity-level',
  'x-polis-internal-token',
] as const;

export function hasTrustedEdgeHeaders(req: IncomingMessage): boolean {
  return TRUSTED_EDGE_HEADERS.some((name) => req.headers[name] !== undefined);
}

export function hasAuthorityFields(body: unknown, fields: readonly string[]): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    fields.some((field) => Object.prototype.hasOwnProperty.call(body, field))
  );
}

/**
 * Proxy to an explicit internal path with X-Polis-Citizen header injected.
 * Maps BFF public paths to service internal paths (e.g. /api/v1/vault/...
 * → /internal/vault/...). The removed proxyWithCitizen used same-path and
 * would 404 since services serve /internal/*.
 */
export async function proxyToPathWithCitizen(
  base: string,
  method: string,
  internalPath: string,
  actor: AuthenticatedActor,
  body?: unknown,
): Promise<unknown> {
  try {
    const hasBody = method !== 'GET' && body !== undefined;
    const upstream = await fetchWithTimeout(
      base + internalPath,
      {
        method,
        headers: trustedActorHeaders(actor),
        body: hasBody ? JSON.stringify(body) : undefined,
      },
      parseInternalFetchTimeoutMs(),
    );
    if (!upstream.ok) {
      return result(
        upstream.status,
        await upstream.json().catch(() => ({ error: 'upstream_error' })),
      );
    }
    return result(upstream.status, await upstream.json());
  } catch (error) {
    return upstreamFailure(error);
  }
}

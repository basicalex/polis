/**
 * @polis/citizen-identity-service — §21 persistent citizen identity (M8, Option A).
 *
 * Owns the `citizens` table. v1 login is email magic-link (single-use, hashed at
 * rest, 15m TTL) with optional passcode. Successful exchange mints an HMAC-signed
 * session token that the BFF validates on every authenticated route via
 * /internal/identity/verify-session. This is real persistent identity (DB
 * accounts, hashed credentials) without an external IdP; it upgrades cleanly to
 * OIDC later (swap the login provider, keep the citizens row + session contract).
 *
 * No SMTP in v1: the magic token is surfaced only by the explicitly enabled
 * non-production stub /internal/identity/dev-tokens route. The exchange +
 * session-token contract is production-shaped; only delivery is stubbed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type Route,
} from '@polis/service-runtime';

import { citizenWire } from './serialize.js';
import { createIdentityProvider } from './identity-provider.js';

const MIN_IDENTITY_HMAC_KEY_BYTES = 32;
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** In-memory dev token store — populated only by the explicitly enabled non-production stub. */
const devTokens = new Map<string, string>();

function identityHmacKey(): string {
  const key = process.env.IDENTITY_HMAC_KEY;
  if (!key || Buffer.byteLength(key, 'utf8') < MIN_IDENTITY_HMAC_KEY_BYTES) {
    throw new Error(
      `IDENTITY_HMAC_KEY must be set to at least ${MIN_IDENTITY_HMAC_KEY_BYTES} bytes`,
    );
  }
  return key;
}

function devTokensEnabled(): boolean {
  return (
    process.env.IDENTITY_DEV_TOKENS === 'true' &&
    process.env.IDENTITY_MODE === 'stub' &&
    process.env.NODE_ENV !== 'production'
  );
}

function sha256(value: string): string {
  return createHmac('sha256', identityHmacKey()).update(value).digest('hex');
}

/** Constant-time string equality (hashed values only). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** Sign {citizenId, exp} → "payload.sig" (both base64url). */
function signSession(citizenId: string): string {
  const payload = Buffer.from(JSON.stringify({ citizenId, exp: Date.now() + SESSION_TTL_MS }));
  const sig = createHmac('sha256', identityHmacKey()).update(payload).digest();
  return `${payload.toString('base64url')}.${sig.toString('base64url')}`;
}

/** Verify a session token → citizenId, or null if tampered/expired. */
function verifySession(sessionToken: string): string | null {
  const dot = sessionToken.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = sessionToken.slice(0, dot);
  const sigB64 = sessionToken.slice(dot + 1);
  const payload = Buffer.from(payloadB64, 'base64url');
  const expected = createHmac('sha256', identityHmacKey()).update(payload).digest();
  const provided = Buffer.from(sigB64, 'base64url');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  let parsed: { citizenId?: string; exp?: number };
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed.citizenId || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
  return parsed.citizenId;
}

/**
 * Best-effort audit emit. Failures (audit-service unreachable) are logged and
 * never fail the originating request — matches contribution/rewards services.
 */
async function emitAudit(event: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
  visibility: 'public' | 'restricted';
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetch(base + '/internal/audit/events', {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: event.visibility,
        actor: { type: 'service', id: 'citizen-identity-service' },
        target: event.target,
        data: event.data,
        correlationId: null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'citizen-identity-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Build the §21 identity route table bound to a DB client. */
export function identityRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('citizen-identity-service'),

    // §21.2 magic-link mint. Always returns {sent:true} (no email enumeration).
    {
      method: 'POST',
      path: '/internal/identity/magic-link',
      handler: async (_req, body) => {
        const input = body as { email?: string };
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!email || !email.includes('@')) {
          return result(400, { error: 'invalid_email' });
        }
        const rawToken = randomBytes(32).toString('hex');
        const tokenHash = sha256(rawToken);
        const expiresAt = new Date(Date.now() + MAGIC_TOKEN_TTL_MS);
        // Upsert by email (unique index). New citizen defaults to verified_resident.
        const existing = await db
          .select()
          .from(schema.citizens)
          .where(eq(schema.citizens.email, email))
          .limit(1);
        const citizenId = existing[0]?.id ?? `cit-${randomBytes(8).toString('hex')}`;
        if (existing[0]) {
          await db
            .update(schema.citizens)
            .set({ magicTokenHash: tokenHash, magicTokenExpiresAt: expiresAt })
            .where(eq(schema.citizens.id, citizenId));
        } else {
          await db.insert(schema.citizens).values({
            id: citizenId,
            email,
            displayName: email.split('@')[0],
            magicTokenHash: tokenHash,
            magicTokenExpiresAt: expiresAt,
          });
        }
        if (devTokensEnabled()) devTokens.set(email, rawToken);
        await emitAudit({
          eventType: 'identity.magic_link.issued',
          action: 'magic-link',
          target: { type: 'citizen', id: citizenId },
          data: { ttlMs: MAGIC_TOKEN_TTL_MS },
          visibility: 'restricted',
        });
        return result(200, { sent: true });
      },
    },

    // §21.2 exchange magic-link (or passcode) → session token.
    {
      method: 'POST',
      path: '/internal/identity/exchange',
      handler: async (_req, body) => {
        const input = body as { email?: string; token?: string; passcode?: string };
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (!email) return result(400, { error: 'invalid_email' });
        const rows = await db
          .select()
          .from(schema.citizens)
          .where(eq(schema.citizens.email, email))
          .limit(1);
        const citizen = rows[0];
        if (!citizen) return result(401, { error: 'invalid_credentials' });

        let ok = false;
        if (typeof input.token === 'string' && input.token && citizen.magicTokenHash) {
          const provided = sha256(input.token);
          const unexpired =
            citizen.magicTokenExpiresAt instanceof Date &&
            citizen.magicTokenExpiresAt.getTime() > Date.now();
          if (unexpired && safeEqualHex(provided, citizen.magicTokenHash)) ok = true;
        } else if (typeof input.passcode === 'string' && input.passcode && citizen.passcodeHash) {
          if (safeEqualHex(sha256(input.passcode), citizen.passcodeHash)) ok = true;
        }
        if (!ok) return result(401, { error: 'invalid_credentials' });

        // Consume the magic token (single-use).
        if (citizen.magicTokenHash) {
          await db
            .update(schema.citizens)
            .set({ magicTokenHash: null, magicTokenExpiresAt: null })
            .where(eq(schema.citizens.id, citizen.id));
        }
        devTokens.delete(email);
        await emitAudit({
          eventType: 'identity.session.exchanged',
          action: 'exchange',
          target: { type: 'citizen', id: citizen.id },
          data: { identityLevel: citizen.identityLevel },
          visibility: 'restricted',
        });
        return result(200, {
          sessionToken: signSession(citizen.id),
          citizen: citizenWire(citizen),
        });
      },
    },

    // BFF auth gate: validate a session token → citizenId + identityLevel.
    {
      method: 'POST',
      path: '/internal/identity/verify-session',
      handler: async (_req, body) => {
        const input = body as { sessionToken?: string };
        const citizenId =
          typeof input.sessionToken === 'string' ? verifySession(input.sessionToken) : null;
        if (!citizenId) return result(401, { error: 'invalid_session' });
        const rows = await db
          .select()
          .from(schema.citizens)
          .where(eq(schema.citizens.id, citizenId))
          .limit(1);
        const citizen = rows[0];
        if (!citizen) return result(401, { error: 'invalid_session' });
        return result(200, { citizenId: citizen.id, identityLevel: citizen.identityLevel });
      },
    },

    // Internal citizen lookup (vault-service ownership checks).
    {
      method: 'GET',
      path: '/internal/identity/citizens/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.citizens)
          .where(eq(schema.citizens.id, params.id))
          .limit(1);
        if (!rows[0]) return result(404, { error: 'not_found' });
        return result(200, citizenWire(rows[0]));
      },
    },
    // M10 OIDC authorize — kick off the Keycloak auth-code + PKCE flow. 404 in
    // stub mode (the seam is OIDC-only); the BFF gates the UI on this 200/404.
    {
      method: 'GET',
      path: '/internal/identity/authorize',
      handler: async (req) => {
        if ((process.env.IDENTITY_MODE ?? 'stub') !== 'oidc') {
          return result(404, { error: 'oidc_required' });
        }
        const redirectUri =
          new URL(req.url ?? '/', 'http://localhost').searchParams.get('redirect_uri') ?? '';
        if (!redirectUri) return result(400, { error: 'redirect_uri_required' });
        const { authorizationUrl, state } = await createIdentityProvider().beginLogin(redirectUri);
        return result(200, { authorizationUrl, state });
      },
    },

    // M10 OIDC callback — exchange code → resolve citizen → mint Polis session.
    // Token-translation boundary: Keycloak never reaches a downstream service.
    {
      method: 'POST',
      path: '/internal/identity/callback',
      handler: async (_req, body) => {
        if ((process.env.IDENTITY_MODE ?? 'stub') !== 'oidc') {
          return result(404, { error: 'oidc_required' });
        }
        const input = body as { code?: string; state?: string; redirectUri?: string };
        if (!input.code || !input.state || !input.redirectUri) {
          return result(400, { error: 'invalid_callback_payload' });
        }
        let resolved;
        try {
          resolved = await createIdentityProvider().completeLogin(
            input.code,
            input.state,
            input.redirectUri,
          );
        } catch (e) {
          return result(400, { error: e instanceof Error ? e.message : 'login_failed' });
        }
        // identity/access.rego enforced in code: OIDC requires a verified email.
        if (!resolved.emailVerified || !resolved.email) {
          return result(403, { error: 'email_not_verified' });
        }

        // Resolve citizen by IdP subject link, else by email, else create.
        const linkRows = await db
          .select()
          .from(schema.externalIdentities)
          .where(
            and(
              eq(schema.externalIdentities.provider, resolved.provider),
              eq(schema.externalIdentities.subject, resolved.subject),
            ),
          )
          .limit(1);
        let citizenId = linkRows[0]?.citizenId;
        if (!citizenId) {
          const byEmail = await db
            .select()
            .from(schema.citizens)
            .where(eq(schema.citizens.email, resolved.email))
            .limit(1);
          if (byEmail[0]) {
            citizenId = byEmail[0].id;
          } else {
            const ins = await db
              .insert(schema.citizens)
              .values({
                id: `cit-${randomBytes(8).toString('hex')}`,
                email: resolved.email,
                displayName: resolved.email.split('@')[0],
              })
              .returning({ id: schema.citizens.id });
            citizenId = ins[0].id;
          }
          // Link the IdP subject. onConflictDoNothing guards the UNIQUE(provider,
          // subject) invariant against a concurrent first-login for the same
          // subject (two tabs): if a sibling won the race, re-resolve its citizen.
          const linked = await db
            .insert(schema.externalIdentities)
            .values({
              id: `ext-${randomBytes(8).toString('hex')}`,
              citizenId,
              provider: resolved.provider,
              subject: resolved.subject,
            })
            .onConflictDoNothing({
              target: [schema.externalIdentities.provider, schema.externalIdentities.subject],
            })
            .returning({ citizenId: schema.externalIdentities.citizenId });
          if (linked.length === 0) {
            const winner = await db
              .select()
              .from(schema.externalIdentities)
              .where(
                and(
                  eq(schema.externalIdentities.provider, resolved.provider),
                  eq(schema.externalIdentities.subject, resolved.subject),
                ),
              )
              .limit(1);
            citizenId = winner[0]?.citizenId ?? citizenId;
          }
        } else {
          // Refresh email if the IdP says it changed.
          await db
            .update(schema.citizens)
            .set({ email: resolved.email })
            .where(
              and(
                eq(schema.citizens.id, citizenId),
                sql`${schema.citizens.email} is distinct from ${resolved.email}`,
              ),
            );
        }

        const cRow = (
          await db.select().from(schema.citizens).where(eq(schema.citizens.id, citizenId)).limit(1)
        )[0];
        if (!cRow) return result(500, { error: 'citizen_resolution_failed' });
        await emitAudit({
          eventType: 'identity.session.oidc.exchanged',
          action: 'exchange',
          target: { type: 'citizen', id: citizenId },
          data: { provider: resolved.provider, subject: resolved.subject },
          visibility: 'restricted',
        });
        return result(200, {
          sessionToken: signSession(citizenId),
          citizen: citizenWire(cRow),
        });
      },
    },

    // Explicit non-production stub escape hatch for local demos and acceptance tests.
    // Returns 404 unless all three dev-token configuration gates are satisfied.
    {
      method: 'GET',
      path: '/internal/identity/dev-tokens',
      handler: async () => {
        if (!devTokensEnabled()) return result(404, { error: 'not_found' });
        return result(200, { tokens: Object.fromEntries(devTokens) });
      },
    },
  ];
}

async function main(): Promise<void> {
  identityHmacKey();
  const port = Number(process.env.PORT ?? 8650);
  const db = getClient();
  startService('citizen-identity-service', port, identityRoutes(db));
  console.log(JSON.stringify({ service: 'citizen-identity-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

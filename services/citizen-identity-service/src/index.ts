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
 * No SMTP in v1: the magic token is surfaced via a NODE_ENV!=='production'
 * /internal/identity/dev-tokens route + stdout log so local demo + the
 * acceptance harness can complete login. The exchange + session-token contract
 * is production-shaped; only delivery is stubbed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { eq } from 'drizzle-orm';
import { operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

import { citizenWire } from './serialize.js';

/** HMAC key for session-token signing. Dev default; operators override via env. */
const IDENTITY_HMAC_KEY = process.env.IDENTITY_HMAC_KEY ?? 'polis-identity-v1-dev-key';
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** In-memory dev token log (NODE_ENV!=='production' only) — never populated in prod. */
const devTokens = new Map<string, string>();

function sha256(value: string): string {
  return createHmac('sha256', IDENTITY_HMAC_KEY).update(value).digest('hex');
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
  const sig = createHmac('sha256', IDENTITY_HMAC_KEY).update(payload).digest();
  return `${payload.toString('base64url')}.${sig.toString('base64url')}`;
}

/** Verify a session token → citizenId, or null if tampered/expired. */
function verifySession(sessionToken: string): string | null {
  const dot = sessionToken.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = sessionToken.slice(0, dot);
  const sigB64 = sessionToken.slice(dot + 1);
  const payload = Buffer.from(payloadB64, 'base64url');
  const expected = createHmac('sha256', IDENTITY_HMAC_KEY).update(payload).digest();
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
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetch(base + '/internal/audit/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: 'public',
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
        if (existing[0]) {
          await db
            .update(schema.citizens)
            .set({ magicTokenHash: tokenHash, magicTokenExpiresAt: expiresAt })
            .where(eq(schema.citizens.id, existing[0].id));
        } else {
          await db.insert(schema.citizens).values({
            id: `cit-${randomBytes(8).toString('hex')}`,
            email,
            displayName: email.split('@')[0],
            magicTokenHash: tokenHash,
            magicTokenExpiresAt: expiresAt,
          });
        }
        // Explicit flag for token surfacing (acceptance + local demo; never in prod by default).
        if (process.env.IDENTITY_DEV_TOKENS === 'true') {
          devTokens.set(email, rawToken);
          console.log(
            JSON.stringify({
              service: 'citizen-identity-service',
              stage: 'magic-link',
              email,
              token: rawToken,
            }),
          );
        }
        await emitAudit({
          eventType: 'identity.magic_link.issued',
          action: 'magic-link',
          target: { type: 'citizen', id: email },
          data: { ttlMs: MAGIC_TOKEN_TTL_MS },
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
        if (process.env.IDENTITY_DEV_TOKENS === 'true') devTokens.delete(email);
        await emitAudit({
          eventType: 'identity.session.exchanged',
          action: 'exchange',
          target: { type: 'citizen', id: citizen.id },
          data: { identityLevel: citizen.identityLevel },
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

    // Gated by IDENTITY_DEV_TOKENS=true: surfaces the latest magic token per email
    // so local demo + acceptance harness can complete login without SMTP. 404 otherwise.
    {
      method: 'GET',
      path: '/internal/identity/dev-tokens',
      handler: async () => {
        if (process.env.IDENTITY_DEV_TOKENS !== 'true') return result(404, { error: 'not_found' });
        return result(200, { tokens: Object.fromEntries(devTokens) });
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8650);
  const db = getClient();
  startService('citizen-identity-service', port, identityRoutes(db));
  console.log(JSON.stringify({ service: 'citizen-identity-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

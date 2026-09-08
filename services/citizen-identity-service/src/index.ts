import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getClient, type DbClient } from '@polis/db';
import {
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type Route,
} from '@polis/service-runtime';

import {
  identityHmacKey,
  identityMode,
  magicLinkDeliveryMode,
  publicAppOrigin as configuredPublicAppOrigin,
  type IdentityEnvironment,
} from './config.js';
import { createMagicLinkDelivery, magicLinkUrl, type MagicLinkDelivery } from './delivery.js';
import {
  DbIdentityRepository,
  type CitizenRow,
  type IdentityRepository,
} from './identity-repository.js';
import {
  createIdentityProvider,
  validateOidcConfiguration,
  type IdentityProvider,
} from './identity-provider.js';
import { DbOidcLoginStateStore, type OidcLoginStateStore } from './oidc-state-store.js';
import { citizenWire } from './serialize.js';

const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSION_TOKEN_LENGTH = 8_192;

/** Raw tokens exist only for the explicit local dev-token route. */
const devTokens = new Map<string, string>();

type AuthenticationMethod = 'magic_link' | 'passcode' | 'oidc';

type SessionClaims = {
  citizenId: string;
  expiresAt: Date;
  method: AuthenticationMethod | null;
};

type AuditEvent = {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
  visibility: 'public' | 'restricted';
};

type AuditEmitter = (event: AuditEvent) => Promise<void>;

export type IdentityRouteDependencies = {
  repository?: IdentityRepository;
  delivery?: MagicLinkDelivery;
  oidcStateStore?: OidcLoginStateStore;
  identityProviderFactory?: () => IdentityProvider;
  auditEmitter?: AuditEmitter;
  now?: () => Date;
  randomMagicToken?: () => string;
  publicAppOrigin?: string;
  env?: IdentityEnvironment;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || /[\s\0]/.test(email)) return null;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  return email;
}

function keyedHash(value: string, env: IdentityEnvironment): string {
  return createHmac('sha256', identityHmacKey(env)).update(value).digest('hex');
}

function signSession(
  citizenId: string,
  issuedAt: Date,
  method: AuthenticationMethod,
  env: IdentityEnvironment,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      citizenId,
      exp: issuedAt.getTime() + SESSION_TTL_MS,
      jti: randomBytes(16).toString('base64url'),
      method,
    }),
  );
  const signature = createHmac('sha256', identityHmacKey(env)).update(payload).digest();
  return `${payload.toString('base64url')}.${signature.toString('base64url')}`;
}

function verifySignedSession(
  sessionToken: string,
  checkedAt: Date,
  env: IdentityEnvironment,
): SessionClaims | null {
  if (!sessionToken || sessionToken.length > MAX_SESSION_TOKEN_LENGTH) return null;
  const segments = sessionToken.split('.');
  if (segments.length !== 2 || !segments[0] || !segments[1]) return null;

  let payload: Buffer;
  let provided: Buffer;
  try {
    payload = Buffer.from(segments[0], 'base64url');
    provided = Buffer.from(segments[1], 'base64url');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', identityHmacKey(env)).update(payload).digest();
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  let parsed: { citizenId?: unknown; exp?: unknown; method?: unknown };
  try {
    parsed = JSON.parse(payload.toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (
    typeof parsed.citizenId !== 'string' ||
    !parsed.citizenId ||
    typeof parsed.exp !== 'number' ||
    !Number.isFinite(parsed.exp) ||
    checkedAt.getTime() >= parsed.exp
  ) {
    return null;
  }
  const method =
    parsed.method === undefined
      ? null
      : parsed.method === 'magic_link' || parsed.method === 'passcode' || parsed.method === 'oidc'
        ? parsed.method
        : null;
  if (parsed.method !== undefined && method === null) return null;
  return { citizenId: parsed.citizenId, expiresAt: new Date(parsed.exp), method };
}

function devTokensEnabled(env: IdentityEnvironment, delivery: MagicLinkDelivery): boolean {
  return (
    delivery.mode === 'dev' &&
    magicLinkDeliveryMode(env) === 'dev' &&
    env.IDENTITY_DEV_TOKENS === 'true' &&
    identityMode(env) === 'stub' &&
    env.NODE_ENV !== 'production'
  );
}

async function emitAudit(event: AuditEvent, env: IdentityEnvironment): Promise<void> {
  const base = env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
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
  } catch {
    console.error(
      JSON.stringify({
        service: 'citizen-identity-service',
        stage: 'audit-emit',
        warning: 'audit_unavailable',
      }),
    );
  }
}

export function validateIdentityConfig(env: IdentityEnvironment = process.env): MagicLinkDelivery {
  identityHmacKey(env);
  const mode = identityMode(env);
  const delivery = createMagicLinkDelivery(env);
  if (mode === 'oidc') validateOidcConfiguration(env);
  return delivery;
}

/** Build the identity route table against a DB client and explicit test seams. */
export function identityRoutes(
  db: DbClient,
  dependencies: IdentityRouteDependencies = {},
): Route[] {
  const env = dependencies.env ?? process.env;
  const repository = dependencies.repository ?? new DbIdentityRepository(db);
  const delivery = dependencies.delivery ?? createMagicLinkDelivery(env);
  const oidcStateStore = dependencies.oidcStateStore ?? new DbOidcLoginStateStore(db);
  const providerFactory =
    dependencies.identityProviderFactory ??
    (() => createIdentityProvider({ stateStore: oidcStateStore, env }));
  const auditEmitter = dependencies.auditEmitter ?? ((event) => emitAudit(event, env));
  const now = dependencies.now ?? (() => new Date());
  const randomMagicToken =
    dependencies.randomMagicToken ?? (() => randomBytes(32).toString('base64url'));
  const publicAppOrigin =
    delivery.mode === 'smtp'
      ? (dependencies.publicAppOrigin ?? configuredPublicAppOrigin(env))
      : undefined;

  return [
    ...operationalRoutes('citizen-identity-service'),
    {
      method: 'POST',
      path: '/internal/identity/magic-link',
      handler: async (_req, body) => {
        if (identityMode(env) === 'oidc') return result(403, { error: 'oidc_required' });
        const input = body as { email?: unknown };
        const email = normalizeEmail(input.email);
        if (!email) return result(400, { error: 'invalid_email' });

        const rawToken = randomMagicToken();
        const requestedAt = now();
        const expiresAt = new Date(requestedAt.getTime() + MAGIC_TOKEN_TTL_MS);
        const citizen = await repository.issueMagicToken({
          email,
          displayName: email.split('@')[0] || 'Citizen',
          tokenHash: keyedHash(rawToken, env),
          expiresAt,
        });

        if (devTokensEnabled(env, delivery)) devTokens.set(email, rawToken);
        if (delivery.mode === 'smtp' && publicAppOrigin) {
          try {
            await delivery.sendMagicLink({
              to: email,
              loginUrl: magicLinkUrl(publicAppOrigin, email, rawToken),
              expiresAt,
            });
          } catch {
            console.error(
              JSON.stringify({
                service: 'citizen-identity-service',
                stage: 'magic-link-delivery',
                warning: 'delivery_failed',
              }),
            );
          }
        }

        await auditEmitter({
          eventType: 'identity.magic_link.issued',
          action: 'magic-link',
          target: { type: 'citizen', id: citizen.id },
          data: { ttlMs: MAGIC_TOKEN_TTL_MS, delivery: delivery.mode },
          visibility: 'restricted',
        });
        return result(200, { sent: true });
      },
    },
    {
      method: 'POST',
      path: '/internal/identity/exchange',
      handler: async (_req, body) => {
        if (identityMode(env) === 'oidc') return result(403, { error: 'oidc_required' });
        const input = body as { email?: unknown; token?: unknown; passcode?: unknown };
        const email = normalizeEmail(input.email);
        if (!email) return result(400, { error: 'invalid_email' });

        let citizen = null;
        let authenticationMethod: AuthenticationMethod | null = null;
        if (typeof input.token === 'string' && input.token && input.token.length <= 1_024) {
          authenticationMethod = 'magic_link';
          citizen = await repository.consumeMagicToken({
            email,
            tokenHash: keyedHash(input.token, env),
            consumedAt: now(),
          });
        } else if (
          typeof input.passcode === 'string' &&
          input.passcode &&
          input.passcode.length <= 256
        ) {
          authenticationMethod = 'passcode';
          citizen = await repository.findByPasscodeHash(email, keyedHash(input.passcode, env));
        }
        if (!citizen || !authenticationMethod) {
          return result(401, { error: 'invalid_credentials' });
        }

        devTokens.delete(email);
        await auditEmitter({
          eventType: 'identity.session.exchanged',
          action: 'exchange',
          target: { type: 'citizen', id: citizen.id },
          data: { identityLevel: citizen.identityLevel },
          visibility: 'restricted',
        });
        return result(200, {
          sessionToken: signSession(citizen.id, now(), authenticationMethod, env),
          citizen: citizenWire(citizen),
        });
      },
    },
    {
      method: 'POST',
      path: '/internal/identity/verify-session',
      handler: async (_req, body) => {
        const input = body as { sessionToken?: unknown };
        if (typeof input.sessionToken !== 'string') {
          return result(401, { error: 'invalid_session' });
        }
        const checkedAt = now();
        const claims = verifySignedSession(input.sessionToken, checkedAt, env);
        if (!claims) return result(401, { error: 'invalid_session' });
        if (identityMode(env) === 'oidc' && claims.method !== 'oidc') {
          return result(401, { error: 'invalid_session' });
        }
        if (await repository.isSessionRevoked(keyedHash(input.sessionToken, env), checkedAt)) {
          return result(401, { error: 'invalid_session' });
        }
        const citizen = await repository.findCitizenById(claims.citizenId);
        if (!citizen) return result(401, { error: 'invalid_session' });
        return result(200, { citizenId: citizen.id, identityLevel: citizen.identityLevel });
      },
    },
    {
      method: 'POST',
      path: '/internal/identity/logout',
      handler: async (_req, body) => {
        const input = body as { sessionToken?: unknown };
        if (typeof input.sessionToken !== 'string' || !input.sessionToken) {
          return result(400, { error: 'invalid_logout_payload' });
        }
        const revokedAt = now();
        const claims = verifySignedSession(input.sessionToken, revokedAt, env);
        if (claims) {
          const newlyRevoked = await repository.revokeSession({
            tokenHash: keyedHash(input.sessionToken, env),
            citizenId: claims.citizenId,
            expiresAt: claims.expiresAt,
            revokedAt,
          });
          if (newlyRevoked) {
            await auditEmitter({
              eventType: 'identity.session.revoked',
              action: 'logout',
              target: { type: 'citizen', id: claims.citizenId },
              data: {},
              visibility: 'restricted',
            });
          }
        }
        return result(200, { revoked: true });
      },
    },
    {
      method: 'GET',
      path: '/internal/identity/citizens/:id',
      handler: async (_req, _body, params) => {
        const citizen = await repository.findCitizenById(params.id);
        if (!citizen) return result(404, { error: 'not_found' });
        return result(200, citizenWire(citizen));
      },
    },
    {
      method: 'GET',
      path: '/internal/identity/authorize',
      handler: async (req) => {
        if (identityMode(env) !== 'oidc') return result(404, { error: 'oidc_required' });
        const redirectUri =
          new URL(req.url ?? '/', 'http://localhost').searchParams.get('redirect_uri') ?? '';
        if (!redirectUri) return result(400, { error: 'redirect_uri_required' });
        try {
          const { authorizationUrl, state } = await providerFactory().beginLogin(redirectUri);
          return result(200, { authorizationUrl, state });
        } catch (error) {
          if (error instanceof Error && error.message === 'redirect_uri_not_allowed') {
            return result(400, { error: 'redirect_uri_not_allowed' });
          }
          return result(503, { error: 'identity_unavailable' });
        }
      },
    },
    {
      method: 'POST',
      path: '/internal/identity/callback',
      handler: async (_req, body) => {
        if (identityMode(env) !== 'oidc') return result(404, { error: 'oidc_required' });
        const input = body as { code?: unknown; state?: unknown; redirectUri?: unknown };
        if (
          typeof input.code !== 'string' ||
          !input.code ||
          typeof input.state !== 'string' ||
          !input.state ||
          typeof input.redirectUri !== 'string' ||
          !input.redirectUri
        ) {
          return result(400, { error: 'invalid_callback_payload' });
        }

        let resolved;
        try {
          resolved = await providerFactory().completeLogin(
            input.code,
            input.state,
            input.redirectUri,
          );
        } catch (error) {
          if (error instanceof Error && error.message === 'invalid_state') {
            return result(400, { error: 'invalid_state' });
          }
          if (error instanceof Error && error.message === 'provider_unavailable') {
            return result(503, { error: 'identity_provider_unavailable' });
          }
          return result(400, { error: 'login_failed' });
        }
        const email = normalizeEmail(resolved.email);
        if (!resolved.emailVerified || !email) {
          return result(403, { error: 'email_not_verified' });
        }

        let citizen: CitizenRow;
        try {
          citizen = await repository.resolveOidcCitizen({
            provider: resolved.provider,
            subject: resolved.subject,
            email,
          });
        } catch (error) {
          if (error instanceof Error && error.message === 'legacy_oidc_binding_review_required') {
            console.error(
              JSON.stringify({
                service: 'citizen-identity-service',
                stage: 'oidc-binding',
                warning: 'legacy_binding_operator_review_required',
              }),
            );
            return result(503, { error: 'identity_binding_review_required' });
          }
          throw error;
        }
        await auditEmitter({
          eventType: 'identity.session.oidc.exchanged',
          action: 'exchange',
          target: { type: 'citizen', id: citizen.id },
          data: { provider: resolved.provider },
          visibility: 'restricted',
        });
        return result(200, {
          sessionToken: signSession(citizen.id, now(), 'oidc', env),
          citizen: citizenWire(citizen),
        });
      },
    },
    {
      method: 'GET',
      path: '/internal/identity/dev-tokens',
      handler: async () => {
        if (!devTokensEnabled(env, delivery)) return result(404, { error: 'not_found' });
        return result(200, { tokens: Object.fromEntries(devTokens) });
      },
    },
  ];
}

async function main(): Promise<void> {
  const delivery = validateIdentityConfig(process.env);
  await delivery.verify();
  const port = Number(process.env.PORT ?? 8650);
  const db = getClient();
  startService('citizen-identity-service', port, identityRoutes(db, { delivery }));
  console.log(JSON.stringify({ service: 'citizen-identity-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

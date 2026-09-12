// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  identityMode,
  parseRedirectAllowlist,
  secureConfiguredUrl,
  type IdentityEnvironment,
} from './config.js';
import type { OidcLoginStateStore } from './oidc-state-store.js';

export type ResolvedIdentity = {
  provider: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

export interface IdentityProvider {
  beginLogin(redirectUri: string): Promise<{ authorizationUrl: string; state: string }>;
  completeLogin(code: string, state: string, redirectUri: string): Promise<ResolvedIdentity>;
}

export type IdentityProviderOptions = {
  stateStore: OidcLoginStateStore;
  env?: IdentityEnvironment;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  stateTtlMs?: number;
};

type OidcConfig = {
  issuer: string;
  authorizationIssuer: string;
  clientId: string;
  clientSecret: string;
  redirectUris: ReadonlySet<string>;
};

const DEFAULT_STATE_TTL_MS = 5 * 60 * 1000;
const OIDC_REQUEST_TIMEOUT_MS = 10_000;

function required(env: IdentityEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when IDENTITY_MODE=oidc`);
  if (/[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function normalizeIssuer(raw: string, name: string, env: IdentityEnvironment): string {
  const parsed = secureConfiguredUrl(raw, name, env);
  if (parsed.search || parsed.hash) throw new Error(`${name} must not contain query or fragment`);
  return parsed.toString().replace(/\/$/, '');
}

function oidcConfig(env: IdentityEnvironment): OidcConfig {
  const issuer = normalizeIssuer(required(env, 'OIDC_ISSUER'), 'OIDC_ISSUER', env);
  const authorizationIssuer = normalizeIssuer(
    env.OIDC_AUTHORIZATION_ISSUER?.trim() || issuer,
    'OIDC_AUTHORIZATION_ISSUER',
    env,
  );
  const clientId = required(env, 'OIDC_CLIENT_ID');
  const clientSecret = required(env, 'OIDC_CLIENT_SECRET');
  return {
    issuer,
    authorizationIssuer,
    clientId,
    clientSecret,
    redirectUris: new Set(parseRedirectAllowlist(env)),
  };
}

function normalizeRequestedRedirect(raw: string, env: IdentityEnvironment): string | null {
  try {
    const parsed = secureConfiguredUrl(raw, 'redirect_uri', env);
    if (parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function validateIdToken(
  idToken: string,
  config: OidcConfig,
  expectedNonce: string,
  now: Date,
): { subject: string } | null {
  const claims = decodeJwtPayload(idToken);
  if (!claims || claims.iss !== config.issuer || typeof claims.sub !== 'string' || !claims.sub) {
    return null;
  }
  const audience = claims.aud;
  const audienceMatches =
    audience === config.clientId ||
    (Array.isArray(audience) && audience.some((item) => item === config.clientId));
  if (!audienceMatches) return null;
  if (Array.isArray(audience) && audience.length > 1 && claims.azp !== config.clientId) return null;
  if (typeof claims.nonce !== 'string' || !safeStringEqual(claims.nonce, expectedNonce))
    return null;
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
  if (Math.floor(now.getTime() / 1000) >= claims.exp) return null;
  return { subject: claims.sub };
}

class OidcIdentityProvider implements IdentityProvider {
  private readonly config: OidcConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly stateTtlMs: number;

  constructor(private readonly options: IdentityProviderOptions) {
    const env = options.env ?? process.env;
    this.config = oidcConfig(env);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.stateTtlMs = options.stateTtlMs ?? DEFAULT_STATE_TTL_MS;
    if (
      !Number.isInteger(this.stateTtlMs) ||
      this.stateTtlMs < 1_000 ||
      this.stateTtlMs > 15 * 60_000
    ) {
      throw new Error('OIDC state TTL must be between 1000 and 900000ms');
    }
  }

  async beginLogin(redirectUri: string): Promise<{ authorizationUrl: string; state: string }> {
    const env = this.options.env ?? process.env;
    const normalizedRedirect = normalizeRequestedRedirect(redirectUri, env);
    if (!normalizedRedirect || !this.config.redirectUris.has(normalizedRedirect)) {
      throw new Error('redirect_uri_not_allowed');
    }

    const codeVerifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const createdAt = this.now();
    await this.options.stateStore.create(
      state,
      {
        codeVerifier,
        nonce,
        redirectUri: normalizedRedirect,
        expiresAt: new Date(createdAt.getTime() + this.stateTtlMs),
      },
      createdAt,
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: normalizedRedirect,
      scope: 'openid email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return {
      authorizationUrl: `${this.config.authorizationIssuer}/protocol/openid-connect/auth?${params.toString()}`,
      state,
    };
  }

  async completeLogin(code: string, state: string, redirectUri: string): Promise<ResolvedIdentity> {
    if (!code || !state || code.length > 4_096 || state.length > 512) {
      throw new Error('invalid_state');
    }
    const consumedAt = this.now();
    const entry = await this.options.stateStore.consume(state, consumedAt);
    if (!entry) throw new Error('invalid_state');

    const env = this.options.env ?? process.env;
    const normalizedRedirect = normalizeRequestedRedirect(redirectUri, env);
    if (
      !normalizedRedirect ||
      !this.config.redirectUris.has(normalizedRedirect) ||
      !safeStringEqual(entry.redirectUri, normalizedRedirect)
    ) {
      throw new Error('invalid_state');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: normalizedRedirect,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: entry.codeVerifier,
    });

    let tokenRes: Response;
    try {
      tokenRes = await this.fetchImpl(`${this.config.issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error('provider_unavailable');
    }
    if (!tokenRes.ok) throw new Error('token_exchange_failed');

    let tokens: { access_token?: unknown; id_token?: unknown };
    try {
      tokens = (await tokenRes.json()) as typeof tokens;
    } catch {
      throw new Error('token_exchange_failed');
    }
    if (typeof tokens.access_token !== 'string' || typeof tokens.id_token !== 'string') {
      throw new Error('token_exchange_failed');
    }
    const idIdentity = validateIdToken(tokens.id_token, this.config, entry.nonce, consumedAt);
    if (!idIdentity) throw new Error('id_token_invalid');

    let userinfoRes: Response;
    try {
      userinfoRes = await this.fetchImpl(`${this.config.issuer}/protocol/openid-connect/userinfo`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(OIDC_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error('provider_unavailable');
    }
    if (!userinfoRes.ok) throw new Error('userinfo_failed');

    let info: { sub?: unknown; email?: unknown; email_verified?: unknown };
    try {
      info = (await userinfoRes.json()) as typeof info;
    } catch {
      throw new Error('userinfo_failed');
    }
    if (typeof info.sub !== 'string' || !safeStringEqual(info.sub, idIdentity.subject)) {
      throw new Error('userinfo_failed');
    }
    return {
      provider: `oidc:${this.config.issuer}`,
      subject: info.sub,
      email: typeof info.email === 'string' ? info.email.trim().toLowerCase() : null,
      emailVerified: info.email_verified === true,
    };
  }
}

export function validateOidcConfiguration(env: IdentityEnvironment = process.env): void {
  oidcConfig(env);
}

/** Resolve the configured provider. The state store is always an explicit dependency. */
export function createIdentityProvider(options: IdentityProviderOptions): IdentityProvider {
  const env = options.env ?? process.env;
  if (identityMode(env) === 'oidc') return new OidcIdentityProvider(options);
  throw new Error('OIDC flow requires IDENTITY_MODE=oidc');
}

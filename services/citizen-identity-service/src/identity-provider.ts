/**
 * @polis/citizen-identity-service — identity-provider seam (M10).
 *
 * {@link createIdentityProvider} is the single abstraction over real persistent
 * identity. Mirrors the `createXClient()` adapter pattern used elsewhere
 * (timestamp-client, paperless-adapter): read an env mode, resolve a concrete
 * adapter, throw on anything unknown so a misconfigured deploy fails fast.
 *
 * Only `stub` (default) and `oidc` (Keycloak) are supported. The stub path is
 * NOT implemented here — it is the frozen dev magic-link flow in index.ts; when
 * IDENTITY_MODE !== 'oidc' this seam is never invoked (the /authorize + /callback
 * routes 404 with `oidc_required`). This keeps the stub path byte-identical.
 *
 * Token-translation boundary (load-bearing): Keycloak never reaches a downstream
 * service. {@link OidcIdentityProvider.completeLogin} exchanges the auth code,
 * resolves a ResolvedIdentity (provider + subject + email), and the caller mints
 * a Polis HMAC session. Downstream services still see X-Polis-Citizen only.
 *
 * CSRF/code-injection defense: PKCE (S256) + single-use state. The state is the
 * key into a module-scope in-memory store (mirrors the devTokens Map pattern);
 * `completeLogin` deletes it before any await, so the same state can complete at
 * most once. The Keycloak auth code is additionally single-use.
 */
import { createHash, randomBytes } from 'node:crypto';

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

/** Single-use PKCE + redirect-URI store, keyed by opaque state. 5-minute TTL. */
const PKCE_TTL_MS = 5 * 60 * 1000;
const pkceStore = new Map<
  string,
  { codeVerifier: string; redirectUri: string; expiresAt: number }
>();

/**
 * OIDC provider. Keycloak is OIDC-conformant, so this speaks the standard
 * authorize/token/userinfo endpoints. Tokens are validated server-side by
 * Keycloak via the userinfo call — no local JWT verification dependency (if a
 * partner threat model later requires id_token signature validation, add `jose`
 * and verify before trusting userinfo; the seam makes this one-function).
 */
class OidcIdentityProvider implements IdentityProvider {
  private readonly issuer: string;
  private readonly authorizationIssuer: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    const issuer = process.env.OIDC_ISSUER;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!issuer || !clientId || !clientSecret) {
      throw new Error(
        'OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET are required when IDENTITY_MODE=oidc',
      );
    }
    this.issuer = issuer.replace(/\/$/, '');
    // The authorization URL is fetched by the browser/host, so it must be
    // host-reachable; token + userinfo are fetched server-side (container DNS).
    // Falls back to OIDC_ISSUER so single-origin prod needs only one variable.
    this.authorizationIssuer = (process.env.OIDC_AUTHORIZATION_ISSUER ?? issuer).replace(/\/$/, '');
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async beginLogin(redirectUri: string): Promise<{ authorizationUrl: string; state: string }> {
    const codeVerifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('hex');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    // Store before any await so completeLogin's single-use delete is authoritative.
    pkceStore.set(state, {
      codeVerifier,
      redirectUri,
      expiresAt: Date.now() + PKCE_TTL_MS,
    });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    const authorizationUrl = `${this.authorizationIssuer}/protocol/openid-connect/auth?${params.toString()}`;
    return { authorizationUrl, state };
  }

  async completeLogin(code: string, state: string, redirectUri: string): Promise<ResolvedIdentity> {
    const entry = pkceStore.get(state);
    // Single-use: delete before any await so a concurrent replay of the same
    // state cannot also pass this check.
    pkceStore.delete(state);
    if (!entry || Date.now() > entry.expiresAt) {
      throw new Error('invalid_state');
    }
    if (entry.redirectUri !== redirectUri) {
      throw new Error('invalid_state');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: entry.codeVerifier,
    });
    const tokenRes = await fetch(`${this.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) throw new Error('token_exchange_failed');
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) throw new Error('token_exchange_failed');

    // Keycloak validates the access_token server-side; userinfo is the trust path.
    const userinfoRes = await fetch(`${this.issuer}/protocol/openid-connect/userinfo`, {
      headers: { authorization: 'Bearer ' + tokens.access_token },
    });
    if (!userinfoRes.ok) throw new Error('userinfo_failed');
    const info = (await userinfoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (!info.sub) throw new Error('userinfo_failed');
    return {
      provider: 'keycloak',
      subject: info.sub,
      email: typeof info.email === 'string' ? info.email : null,
      emailVerified: info.email_verified === true,
    };
  }
}

/**
 * Resolve the identity adapter from IDENTITY_MODE. `stub` (default) is NOT a
 * provider here — the dev magic-link flow owns it; callers must check the mode
 * is `oidc` before touching this seam (the routes do). Any other value throws.
 */
export function createIdentityProvider(): IdentityProvider {
  const mode = process.env.IDENTITY_MODE ?? 'stub';
  if (mode === 'oidc') return new OidcIdentityProvider();
  throw new Error(`IDENTITY_MODE=${mode} is not supported; OIDC flow requires IDENTITY_MODE=oidc`);
}

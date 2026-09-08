export type IdentityEnvironment = Readonly<Record<string, string | undefined>>;

export const MIN_IDENTITY_HMAC_KEY_BYTES = 32;

export function identityHmacKey(env: IdentityEnvironment = process.env): string {
  const key = env.IDENTITY_HMAC_KEY;
  if (!key || Buffer.byteLength(key, 'utf8') < MIN_IDENTITY_HMAC_KEY_BYTES) {
    throw new Error(
      `IDENTITY_HMAC_KEY must be set to at least ${MIN_IDENTITY_HMAC_KEY_BYTES} bytes`,
    );
  }
  return key;
}

export type IdentityMode = 'stub' | 'oidc';

export function identityMode(env: IdentityEnvironment = process.env): IdentityMode {
  const mode = env.IDENTITY_MODE ?? 'stub';
  if (mode !== 'stub' && mode !== 'oidc') {
    throw new Error('IDENTITY_MODE must be stub or oidc');
  }
  return mode;
}

export type MagicLinkDeliveryMode = 'dev' | 'smtp';

export function magicLinkDeliveryMode(
  env: IdentityEnvironment = process.env,
): MagicLinkDeliveryMode {
  const mode = env.IDENTITY_MAGIC_LINK_DELIVERY ?? 'dev';
  if (mode !== 'dev' && mode !== 'smtp') {
    throw new Error('IDENTITY_MAGIC_LINK_DELIVERY must be dev or smtp');
  }
  return mode;
}

export function parseBoolean(
  env: IdentityEnvironment,
  name: string,
  defaultValue = false,
): boolean {
  const value = env[name];
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * Parse an operator-controlled URL. HTTPS is mandatory away from loopback.
 * Loopback HTTP needs an explicit flag and is never accepted in production.
 */
export function secureConfiguredUrl(
  raw: string | undefined,
  name: string,
  env: IdentityEnvironment = process.env,
): URL {
  if (!raw) throw new Error(`${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${name} must use HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  if (parsed.protocol === 'http:') {
    const localAllowed =
      isLoopbackHostname(parsed.hostname) &&
      env.NODE_ENV !== 'production' &&
      parseBoolean(env, 'IDENTITY_ALLOW_HTTP_LOCALHOST');
    if (!localAllowed) {
      throw new Error(
        `${name} must use HTTPS; loopback HTTP needs IDENTITY_ALLOW_HTTP_LOCALHOST=true outside production`,
      );
    }
  }
  return parsed;
}

/** PUBLIC_APP_URL contributes only its validated origin to magic links. */
export function publicAppOrigin(env: IdentityEnvironment = process.env): string {
  const parsed = secureConfiguredUrl(env.PUBLIC_APP_URL, 'PUBLIC_APP_URL', env);
  return parsed.origin;
}

export function parseRedirectAllowlist(env: IdentityEnvironment = process.env): string[] {
  const plural = env.OIDC_REDIRECT_URIS?.trim();
  const singular = env.OIDC_REDIRECT_URI?.trim();
  let values: string[] = [];
  if (plural) {
    if (plural.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(plural);
      } catch {
        throw new Error('OIDC_REDIRECT_URIS must be a JSON array or comma-separated list');
      }
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
        throw new Error('OIDC_REDIRECT_URIS must contain only URLs');
      }
      values = parsed;
    } else {
      values = plural.split(',');
    }
  } else if (singular) {
    values = [singular];
  }

  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = secureConfiguredUrl(value, 'OIDC redirect URI', env);
      if (parsed.hash) throw new Error('OIDC redirect URIs must not contain fragments');
      return parsed.toString();
    });
  if (normalized.length === 0) {
    throw new Error('OIDC_REDIRECT_URIS or OIDC_REDIRECT_URI is required when IDENTITY_MODE=oidc');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('OIDC redirect URI allowlist contains duplicates');
  }
  return normalized;
}

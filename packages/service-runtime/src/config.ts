export type DeploymentProfile = 'dev' | 'pilot';

export interface RuntimeConfig {
  deploymentProfile: DeploymentProfile;
  internalApiToken: string | undefined;
  corsAllowedOrigins: readonly string[];
}

export class RuntimeConfigError extends Error {
  constructor(
    readonly setting: 'DEPLOYMENT_PROFILE' | 'INTERNAL_API_TOKEN' | 'CORS_ALLOWED_ORIGINS',
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeConfigError';
  }
}

const DEVELOPMENT_INTERNAL_TOKENS: Record<string, true> = {
  change_me_internal_service_token: true,
  changeme: true,
  'change-me': true,
  development: true,
  dev: true,
  local: true,
  'polis-internal-dev-token': true,
  replace_me: true,
  test: true,
};

export function parseDeploymentProfile(value = process.env.DEPLOYMENT_PROFILE): DeploymentProfile {
  const profile = value?.trim() || 'dev';
  if (profile === 'dev' || profile === 'pilot') return profile;
  throw new RuntimeConfigError(
    'DEPLOYMENT_PROFILE',
    'DEPLOYMENT_PROFILE must be either dev or pilot',
  );
}

function parseCorsAllowedOrigins(
  value: string | undefined,
  profile: DeploymentProfile,
): readonly string[] {
  const configured = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = configured?.length ? configured : profile === 'dev' ? ['*'] : [];

  if (profile === 'pilot' && (origins.length === 0 || origins.includes('*'))) {
    throw new RuntimeConfigError(
      'CORS_ALLOWED_ORIGINS',
      'CORS_ALLOWED_ORIGINS must contain an explicit allowlist in pilot',
    );
  }
  if (origins.includes('*') && origins.length !== 1) {
    throw new RuntimeConfigError(
      'CORS_ALLOWED_ORIGINS',
      'CORS_ALLOWED_ORIGINS cannot combine * with explicit origins',
    );
  }
  for (const origin of origins) {
    if (origin === '*') continue;
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new RuntimeConfigError(
        'CORS_ALLOWED_ORIGINS',
        'CORS_ALLOWED_ORIGINS contains an invalid origin',
      );
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      throw new RuntimeConfigError(
        'CORS_ALLOWED_ORIGINS',
        'CORS_ALLOWED_ORIGINS contains an invalid origin',
      );
    }
  }
  return origins;
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const deploymentProfile = parseDeploymentProfile(env.DEPLOYMENT_PROFILE);
  const internalApiToken = env.INTERNAL_API_TOKEN?.trim() || undefined;
  const corsAllowedOrigins = parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS, deploymentProfile);

  if (deploymentProfile === 'pilot') {
    if (!internalApiToken) {
      throw new RuntimeConfigError('INTERNAL_API_TOKEN', 'INTERNAL_API_TOKEN is required in pilot');
    }
    if (DEVELOPMENT_INTERNAL_TOKENS[internalApiToken.toLowerCase()]) {
      throw new RuntimeConfigError(
        'INTERNAL_API_TOKEN',
        'INTERNAL_API_TOKEN cannot use a development value in pilot',
      );
    }
    if (Buffer.byteLength(internalApiToken, 'utf8') < 32) {
      throw new RuntimeConfigError(
        'INTERNAL_API_TOKEN',
        'INTERNAL_API_TOKEN must be at least 32 bytes in pilot',
      );
    }
  }

  return { deploymentProfile, internalApiToken, corsAllowedOrigins };
}

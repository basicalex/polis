import { checkDatabase, runMigrationsOnce } from '@polis/db';
import {
  MAX_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  internalHeaders,
  parseDeploymentProfile,
  type ReadinessStatus,
} from '@polis/service-runtime';

const DEFAULT_INTERNAL_FETCH_TIMEOUT_MS = 5_000;
const MIN_DATABASE_CHECK_TIMEOUT_MS = 100;
const MAX_DATABASE_CHECK_TIMEOUT_MS = 10_000;

export function parseInternalFetchTimeoutMs(value = process.env.INTERNAL_FETCH_TIMEOUT_MS): number {
  const timeoutMs =
    value === undefined || value.trim() === '' ? DEFAULT_INTERNAL_FETCH_TIMEOUT_MS : Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FETCH_TIMEOUT_MS) {
    throw new RangeError(
      `INTERNAL_FETCH_TIMEOUT_MS must be an integer between 1 and ${MAX_FETCH_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

/** The approved pilot is synthetic/public-read only and must always use the blocked edge. */
export function validatePlatformConfig(env: NodeJS.ProcessEnv = process.env): void {
  parseInternalFetchTimeoutMs(env.INTERNAL_FETCH_TIMEOUT_MS);
  if (parseDeploymentProfile(env.DEPLOYMENT_PROFILE) === 'pilot' && env.PUBLIC_EDGE !== 'true') {
    throw new Error('DEPLOYMENT_PROFILE=pilot requires PUBLIC_EDGE=true');
  }
}

type DatabaseCheck = (url: string | undefined, timeoutMs: number) => Promise<unknown>;
type TimedFetch = typeof fetchWithTimeout;

export interface PlatformReadinessOptions {
  env?: NodeJS.ProcessEnv;
  databaseCheck?: DatabaseCheck;
  timedFetch?: TimedFetch;
  readinessHeaders?: () => Record<string, string>;
}

export async function checkPlatformReadiness(
  options: PlatformReadinessOptions = {},
): Promise<ReadinessStatus> {
  const env = options.env ?? process.env;
  const timeoutMs = parseInternalFetchTimeoutMs(env.INTERNAL_FETCH_TIMEOUT_MS);
  const databaseTimeoutMs = Math.max(
    MIN_DATABASE_CHECK_TIMEOUT_MS,
    Math.min(timeoutMs, MAX_DATABASE_CHECK_TIMEOUT_MS),
  );

  try {
    await (options.databaseCheck ?? checkDatabase)(env.DATABASE_URL, databaseTimeoutMs);
  } catch {
    return { ready: false, dependency: 'database' };
  }

  const requiresPilotUpstreams =
    env.PUBLIC_EDGE === 'true' || parseDeploymentProfile(env.DEPLOYMENT_PROFILE) === 'pilot';
  const dependencies: Array<{ label: string; url: string }> = [];
  if (requiresPilotUpstreams) {
    dependencies.push(
      {
        label: 'governance_graph',
        url: (env.GRAPH_INTERNAL_URL ?? 'http://localhost:8100') + '/readyz',
      },
      { label: 'audit', url: (env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600') + '/readyz' },
      { label: 'proof', url: (env.PROOF_INTERNAL_URL ?? 'http://localhost:8700') + '/readyz' },
      { label: 'polis', url: (env.POLIS_INTERNAL_URL ?? 'http://localhost:8200') + '/readyz' },
    );
  }
  if (env.PUBLIC_EDGE !== 'true') {
    dependencies.push({
      label: 'complaints',
      url: (env.COMPLAINTS_INTERNAL_URL ?? 'http://localhost:8970') + '/readyz',
    });
  }
  const timedFetch = options.timedFetch ?? fetchWithTimeout;
  const readinessHeaders = options.readinessHeaders ?? internalHeaders;
  const statuses = await Promise.all(
    dependencies.map(async ({ url }) => {
      try {
        const response = await timedFetch(url, { headers: readinessHeaders() }, timeoutMs);
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  const failedIndex = statuses.indexOf(false);
  return failedIndex === -1
    ? { ready: true }
    : { ready: false, dependency: dependencies[failedIndex]!.label };
}

export interface PlatformMigrationOptions {
  env?: NodeJS.ProcessEnv;
  migrate?: () => Promise<void>;
  warn?: (message: string) => void;
}

export async function runPlatformMigrations(options: PlatformMigrationOptions = {}): Promise<void> {
  const profile = parseDeploymentProfile((options.env ?? process.env).DEPLOYMENT_PROFILE);
  try {
    await (options.migrate ?? runMigrationsOnce)();
  } catch (error) {
    if (profile === 'pilot') throw error;
    const message = error instanceof Error ? error.message : 'unknown';
    (options.warn ?? console.error)(
      JSON.stringify({ service: 'platform-api', stage: 'db-migrate', warning: message }),
    );
  }
}

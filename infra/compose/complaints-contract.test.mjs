import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const composeDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(composeDirectory, '../..');
const developmentComposePath = join(composeDirectory, 'docker-compose.yml');
const pilotComposePath = join(composeDirectory, 'docker-compose.pilot.yml');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'polis-complaints-contract-'));
const pilotEnvPath = join(temporaryDirectory, '.env.pilot');

after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

const pilotEnvironment = {
  PILOT_HOSTNAME: 'pilot.example.test',
  PILOT_ACME_EMAIL: 'operator@example.test',
  POSTGRES_USER: 'pilot_contract_user',
  POSTGRES_PASSWORD: 'contract-only-postgres-password',
  POSTGRES_DB: 'pilot_contract_db',
  DATABASE_URL:
    'postgresql://pilot_contract_user:contract-only-postgres-password@postgres:5432/pilot_contract_db',
  INTERNAL_API_TOKEN: '0123456789abcdef0123456789abcdef0123456789abcdef',
  CORS_ALLOWED_ORIGINS: 'https://public.example.test',
  PILOT_IMAGE_REPOSITORY: 'registry.example.test/polis',
  PILOT_IMAGE_TAG: 'contract-test',
  GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
  BUILD_TIME: '2026-08-03T00:00:00Z',
  SOURCE_URL: 'https://example.test/source',
};

function composeConfig(path, environment = {}, envFile) {
  const args = ['compose', '--project-name', 'polis-complaints-contract'];
  if (envFile) args.push('--env-file', envFile);
  args.push('-f', path, 'config', '--format', 'json');
  const result = spawnSync('docker', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...environment },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('development Compose wires and hardens the private complaints service', () => {
  const config = composeConfig(developmentComposePath, {
    INTERNAL_API_TOKEN: 'complaints-contract-token',
  });
  const complaints = config.services['complaints-service'];

  assert.ok(complaints);
  assert.equal(complaints.build.args.SERVICE, 'complaints-service');
  assert.equal(complaints.environment.DATABASE_URL, 'postgres://polis:polis@postgres:5432/polis');
  assert.equal(complaints.environment.AUDIT_INTERNAL_URL, 'http://audit-service:8600');
  assert.equal(complaints.environment.INTERNAL_API_TOKEN, 'complaints-contract-token');
  assert.equal(complaints.environment.DEPLOYMENT_PROFILE, 'dev');
  assert.equal(complaints.depends_on.postgres.condition, 'service_healthy');
  assert.equal(complaints.depends_on['audit-service'].condition, 'service_healthy');
  assert.deepEqual(complaints.expose, ['8970']);
  assert.equal(complaints.ports, undefined);
  assert.ok(complaints.healthcheck.test.join(' ').includes('http://localhost:8970/readyz'));
  assert.equal(complaints.user, 'bun');
  assert.equal(complaints.read_only, true);
  assert.equal(complaints.init, true);
  assert.ok(complaints.tmpfs.some((entry) => entry.startsWith('/tmp:')));
  assert.ok(complaints.cap_drop.includes('ALL'));
  assert.ok(complaints.security_opt.includes('no-new-privileges:true'));

  const platform = config.services['platform-api'];
  assert.equal(platform.depends_on['complaints-service'].condition, 'service_healthy');
  assert.equal(platform.environment.COMPLAINTS_INTERNAL_URL, 'http://complaints-service:8970');

  const identity = config.services['citizen-identity-service'];
  assert.equal(identity.environment.NODE_ENV, 'development');
  assert.equal(identity.environment.DEPLOYMENT_PROFILE, 'dev');
  assert.equal(identity.environment.IDENTITY_DEV_TOKENS, 'true');
  assert.ok(identity.environment.IDENTITY_HMAC_KEY.length >= 32);

  const aiGateway = config.services['ai-gateway'];
  assert.equal(aiGateway.environment.AI_DEPLOYMENT_PROFILE, 'development');
  assert.equal(aiGateway.healthcheck.test[0], 'CMD');
  assert.equal(aiGateway.healthcheck.test[1], 'python');
  assert.ok(aiGateway.healthcheck.test.join(' ').includes('http://localhost:8550/readyz'));

  assert.equal(config.services['complaints-service-debug'], undefined);
  const debugConfig = composeConfig(developmentComposePath, {
    INTERNAL_API_TOKEN: 'complaints-contract-token',
    COMPOSE_PROFILES: 'debug',
  });
  const debug = debugConfig.services['complaints-service-debug'];
  assert.ok(debug);
  assert.deepEqual(
    debug.ports.map((port) => `${port.published}/${port.target}`),
    ['8970/8970'],
  );
  assert.ok(debug.command.join(' ').includes('tcp-connect:complaints-service:8970'));
});

test('isolated pilot Compose remains complaint-free', () => {
  writeFileSync(
    pilotEnvPath,
    Object.entries(pilotEnvironment)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  const pilot = composeConfig(pilotComposePath, {}, pilotEnvPath);
  assert.equal(pilot.services['complaints-service'], undefined);
  assert.equal(pilot.services['complaints-service-debug'], undefined);
  assert.equal(pilot.services['platform-api'].environment.COMPLAINTS_INTERNAL_URL, undefined);
});

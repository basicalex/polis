import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const composeDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(composeDirectory, '../..');
const composePath = join(composeDirectory, 'docker-compose.pilot.yml');
const composeSource = readFileSync(composePath, 'utf8');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'polis-pilot-contract-'));
const envPath = join(temporaryDirectory, '.env.pilot');

after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

const safeEnvironment = {
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

const requiredVariables = Object.keys(safeEnvironment);
const allowedServices = [
  'audit-service',
  'caddy',
  'governance-graph-api',
  'platform-api',
  'polis-bridge-service',
  'postgres',
  'proof-service',
  'seed',
];
const nodeServices = [
  'seed',
  'governance-graph-api',
  'audit-service',
  'proof-service',
  'polis-bridge-service',
  'platform-api',
];
const apiServices = nodeServices.filter((name) => name !== 'seed');

function writeEnvironment(values) {
  writeFileSync(
    envPath,
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
}

function composeConfig(values = safeEnvironment) {
  writeEnvironment(values);
  return spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      'polis-pilot-contract',
      '--env-file',
      envPath,
      '-f',
      composePath,
      'config',
      '--format',
      'json',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        HOME: process.env.HOME ?? temporaryDirectory,
        PATH: process.env.PATH ?? '',
      },
    },
  );
}

function resolvedConfig() {
  const result = composeConfig();
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function networkNames(service) {
  return Object.keys(service.networks ?? {}).sort();
}

test('pilot Compose resolves to the exact isolated service and network contract', () => {
  const config = resolvedConfig();
  assert.deepEqual(Object.keys(config.services).sort(), allowedServices);
  assert.equal(config.networks.backend.internal, true);

  assert.deepEqual(networkNames(config.services.postgres), ['backend']);
  assert.deepEqual(networkNames(config.services.seed), ['backend']);
  for (const serviceName of [
    'governance-graph-api',
    'audit-service',
    'proof-service',
    'polis-bridge-service',
  ]) {
    assert.deepEqual(networkNames(config.services[serviceName]), ['backend']);
  }
  assert.deepEqual(networkNames(config.services['platform-api']), ['backend', 'edge']);
  assert.deepEqual(networkNames(config.services.caddy), ['edge']);

  for (const [serviceName, service] of Object.entries(config.services)) {
    if (serviceName === 'caddy') continue;
    assert.equal(service.ports, undefined, `${serviceName} must not publish a host port`);
  }
  const publishedPorts = config.services.caddy.ports
    .map((port) => `${port.published}/${port.protocol}`)
    .sort();
  assert.deepEqual(publishedPorts, ['443/tcp', '443/udp', '80/tcp']);
});

test('pilot services use required secrets, public-edge isolation, readiness, and hardening', () => {
  const config = resolvedConfig();

  for (const serviceName of nodeServices) {
    const service = config.services[serviceName];
    assert.equal(service.environment.DEPLOYMENT_PROFILE, 'pilot');
    assert.equal(service.environment.NODE_ENV, 'production');
    assert.equal(service.environment.INTERNAL_API_TOKEN, safeEnvironment.INTERNAL_API_TOKEN);
    assert.equal(service.environment.CORS_ALLOWED_ORIGINS, safeEnvironment.CORS_ALLOWED_ORIGINS);
    assert.equal(service.read_only, true);
    assert.equal(service.user, 'node');
    assert.equal(service.init, true);
    assert.ok(service.cap_drop.includes('ALL'));
    assert.ok(service.security_opt.includes('no-new-privileges:true'));
    assert.ok(service.tmpfs.some((entry) => entry.startsWith('/tmp:')));
  }

  for (const serviceName of apiServices) {
    const service = config.services[serviceName];
    assert.ok(service.healthcheck.test.join(' ').includes('/readyz'));
    assert.equal(service.restart, 'unless-stopped');
  }
  assert.deepEqual(config.services.seed.command, ['node', 'packages/db/dist/seed.js']);
  assert.equal(config.services.seed.restart, 'no');
  assert.equal(config.services.postgres.ports, undefined);
  assert.ok(
    config.services.postgres.volumes.some((volume) => volume.target === '/var/lib/postgresql/data'),
  );
  assert.ok(config.services.postgres.healthcheck.test.join(' ').includes('pg_isready'));

  const platformEnvironment = config.services['platform-api'].environment;
  assert.equal(platformEnvironment.PUBLIC_EDGE, 'true');
  assert.equal(platformEnvironment.IDENTITY_DEV_TOKENS, 'false');
  const upstreams = Object.keys(platformEnvironment)
    .filter((name) => name.endsWith('_INTERNAL_URL'))
    .sort();
  assert.deepEqual(upstreams, [
    'AUDIT_INTERNAL_URL',
    'GRAPH_INTERNAL_URL',
    'POLIS_INTERNAL_URL',
    'PROOF_INTERNAL_URL',
  ]);
});

test('pilot Compose has no fallback interpolation or development provider configuration', () => {
  assert.doesNotMatch(composeSource, /\$\{[^}\n]+:-/);
  assert.doesNotMatch(composeSource, /MOCK_EXTERNALS|\b(?:stub|mock)\b/i);
  assert.doesNotMatch(
    composeSource,
    /POLIS_MODE|IDENTITY_MODE|AI_MODE|SIGNATURE_MODE|TIMESTAMP_MODE/,
  );
});

test('every required deployment input fails closed when absent', () => {
  for (const missing of requiredVariables) {
    const values = { ...safeEnvironment };
    delete values[missing];
    const result = composeConfig(values);
    assert.equal(result.error, undefined, result.error?.message);
    assert.notEqual(result.status, 0, `${missing} unexpectedly resolved`);
    assert.match(result.stderr, new RegExp(missing));
  }
});

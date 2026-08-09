// Dev orchestrator: launches catalogued Node services in dependency order and waits
// until each is ready. platform-api runs DB migrations at boot. The Python
// ai-gateway remains an external process and is not launched here.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, validateCatalog } from './service-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = await loadCatalog(root);
const catalogErrors = validateCatalog(catalog);
if (catalogErrors.length) {
  throw new Error(`invalid service catalog:\n${catalogErrors.join('\n')}`);
}
const services = catalog.services
  .filter((service) => service.runtime === 'node-24' && service.dev.launch)
  .sort((left, right) => left.dev.order - right.dev.order);

const portOf = (service) => Number(process.env[service.devPortEnv] ?? service.defaultPort);

/** Resolve when `url` returns 2xx, rejecting after `timeoutMs`. */
function pollReady(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolveReady, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolveReady();
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`not ready at ${url}`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const children = [];
const cleanup = () => {
  for (const child of children) child.process.kill('SIGTERM');
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

for (const service of services) {
  const port = portOf(service);
  const child = spawn('bun', ['run', '--filter', service.workspace, 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOYMENT_PROFILE: process.env.DEPLOYMENT_PROFILE ?? 'dev',
      CORS_ALLOWED_ORIGINS:
        process.env.CORS_ALLOWED_ORIGINS ??
        [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://localhost:8080',
          'http://127.0.0.1:8080',
          'http://localhost:4321',
          'http://127.0.0.1:4321',
          'http://localhost:4324',
          'http://127.0.0.1:4324',
        ].join(','),
      IDENTITY_HMAC_KEY:
        process.env.IDENTITY_HMAC_KEY ?? 'local-dev-only-identity-hmac-key-never-use-outside-local',
      INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN ?? 'polis-internal-dev-token',
      GRAPH_INTERNAL_URL: process.env.GRAPH_INTERNAL_URL ?? 'http://localhost:8100',
      AUDIT_INTERNAL_URL: process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600',
      POLIS_INTERNAL_URL: process.env.POLIS_INTERNAL_URL ?? 'http://localhost:8200',
      POLIS_MODE: process.env.POLIS_MODE ?? 'stub',
      PAPERLESS_INTERNAL_URL: process.env.PAPERLESS_INTERNAL_URL ?? 'http://localhost:8300',
      CANONICALIZATION_INTERNAL_URL:
        process.env.CANONICALIZATION_INTERNAL_URL ?? 'http://localhost:8500',
      REWARDS_INTERNAL_URL: process.env.REWARDS_INTERNAL_URL ?? 'http://localhost:8460',
      IDENTITY_INTERNAL_URL: process.env.IDENTITY_INTERNAL_URL ?? 'http://localhost:8650',
      VAULT_INTERNAL_URL: process.env.VAULT_INTERNAL_URL ?? 'http://localhost:8750',
      VC_ISSUER_INTERNAL_URL: process.env.VC_ISSUER_INTERNAL_URL ?? 'http://localhost:8950',
      IDENTITY_DEV_TOKENS: 'true',
      IDENTITY_MODE: process.env.IDENTITY_MODE ?? 'stub',
      PROOF_INTERNAL_URL: process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700',
      TIMESTAMP_INTERNAL_URL: process.env.TIMESTAMP_INTERNAL_URL ?? 'http://localhost:8800',
      SIGNATURE_INTERNAL_URL: process.env.SIGNATURE_INTERNAL_URL ?? 'http://localhost:8900',
      SIGNING_INTERNAL_URL: process.env.SIGNING_INTERNAL_URL ?? 'http://localhost:8960',
      CONTRIBUTION_INTERNAL_URL: process.env.CONTRIBUTION_INTERNAL_URL ?? 'http://localhost:8450',
      COMPLAINTS_INTERNAL_URL: process.env.COMPLAINTS_INTERNAL_URL ?? 'http://localhost:8970',
      PAPERLESS_MODE: process.env.PAPERLESS_MODE ?? 'stub',
      TIMESTAMP_MODE: process.env.TIMESTAMP_MODE ?? 'stub',
      SIGNATURE_MODE: process.env.SIGNATURE_MODE ?? 'stub',
      SIGNING_PROVIDER: process.env.SIGNING_PROVIDER ?? 'stub',
      ARTIFACT_STORE_MODE: process.env.ARTIFACT_STORE_MODE ?? 'database',
    },
  });
  child.on('exit', (code) => {
    if (code) process.exit(code ?? 0);
  });
  children.push({ name: service.name, process: child });
  try {
    await pollReady(`http://127.0.0.1:${port}${service.healthRoute}`);
    console.log(`[dev-services] ${service.name} ready at :${port}`);
  } catch (error) {
    console.error(`[dev-services] ${service.name} ${error.message}`);
    cleanup();
    process.exit(1);
  }
}
console.log('[dev-services] all services ready');

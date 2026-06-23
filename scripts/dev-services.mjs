// Dev orchestrator: launches the TS services and waits until each is healthy.
// Order: governance-graph-api + audit-service first, then platform-api (which
// proxies to them). platform-api also runs DB migrations at boot.
import { spawn } from 'node:child_process';

const services = [
  { name: 'governance-graph-api', filter: '@polis/governance-graph-api', port: 8100 },
  { name: 'audit-service', filter: '@polis/audit-service', port: 8600 },
  { name: 'paperless-adapter', filter: '@polis/paperless-adapter', port: 8300 },
  { name: 'canonicalization-service', filter: '@polis/canonicalization-service', port: 8500 },
  { name: 'proof-service', filter: '@polis/proof-service', port: 8700 },
  { name: 'citizen-identity-service', filter: '@polis/citizen-identity-service', port: 8650 },
  { name: 'citizen-vault-service', filter: '@polis/citizen-vault-service', port: 8750 },
  { name: 'vc-issuer-service', filter: '@polis/vc-issuer-service', port: 8950 },
  { name: 'rewards-service', filter: '@polis/rewards-service', port: 8460 },
  { name: 'contribution-service', filter: '@polis/contribution-service', port: 8450 },
  { name: 'platform-api', filter: '@polis/platform-api', port: 8080 },
];

const portOf = (name) => {
  const envKey = `${name.replace(/-/g, '_').toUpperCase()}_PORT`;
  const found = services.find((s) => s.name === name);
  return Number(process.env[envKey] ?? found.port);
};

/** Resolve when `url` returns 2xx, rejecting after `timeoutMs`. */
function pollReady(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
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
  for (const c of children) c.child.kill('SIGTERM');
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

for (const svc of services) {
  const port = portOf(svc.name);
  const child = spawn('pnpm', ['--filter', svc.filter, 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
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
      PROOF_INTERNAL_URL: process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700',
      CONTRIBUTION_INTERNAL_URL: process.env.CONTRIBUTION_INTERNAL_URL ?? 'http://localhost:8450',
      PAPERLESS_MODE: process.env.PAPERLESS_MODE ?? 'stub',
    },
  });
  child.on('exit', (code) => {
    if (code) process.exit(code ?? 0);
  });
  children.push({ name: svc.name, child });
  try {
    await pollReady(`http://127.0.0.1:${port}/healthz`);
    console.log(`[dev-services] ${svc.name} ready at :${port}`);
  } catch (err) {
    console.error(`[dev-services] ${svc.name} ${err.message}`);
    cleanup();
    process.exit(1);
  }
}
console.log('[dev-services] all services ready');

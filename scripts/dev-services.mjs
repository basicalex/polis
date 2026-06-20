// Dev orchestrator: launches the TS services and waits until each is healthy.
// Order: governance-graph-api + audit-service first, then platform-api (which
// proxies to them). platform-api also runs DB migrations at boot.
import { spawn } from 'node:child_process';

const services = [
  { name: 'governance-graph-api', filter: '@polis/governance-graph-api', port: 8100 },
  { name: 'audit-service', filter: '@polis/audit-service', port: 8600 },
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

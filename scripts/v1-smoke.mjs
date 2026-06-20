// v1 smoke test: asserts status + body shape on the §23 public BFF paths.
// Self-builds the workspace if platform-api's dist is missing, then starts the
// service in fixture mode (no DB required) and exits non-zero on any mismatch.
import { existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const PORT = Number(process.env.PLATFORM_API_PORT ?? 8080);
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = 'services/platform-api/dist/index.js';

function assert(label, cond, detail = '') {
  if (!cond) throw new Error(`smoke failed: ${label} ${detail}`.trim());
  console.log(`  ok  ${label}`);
}

async function poll(timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error('platform-api did not become ready');
    await new Promise((r) => setTimeout(r, 300));
  }
}

if (!existsSync(DIST)) {
  console.log('[v1-smoke] dist missing — building workspace…');
  execSync('pnpm -r build', { stdio: 'inherit' });
}

// Fixture mode: no DATABASE_URL → runMigrationsOnce is caught, fixtures served.
const svc = spawn('node', [DIST], { stdio: ['ignore', 'pipe', 'pipe'] });
svc.stdout.on('data', (d) => process.stderr.write(d));
svc.stderr.on('data', (d) => process.stderr.write(d));

let failed = false;
try {
  await poll();
  console.log('[v1-smoke] checking §23 contract…');

  const hz = await (await fetch(`${BASE}/healthz`)).json();
  assert('GET /healthz → status=ok', hz.status === 'ok', JSON.stringify(hz));

  const ver = await (await fetch(`${BASE}/version`)).json();
  assert(
    'GET /version → version present',
    typeof ver.version === 'string' && ver.version.length > 0,
  );
  assert('GET /version → gitSha present', 'gitSha' in ver);

  // platform-api is the §23 proxy edge; the governance body shapes (institutions,
  // roles, processes, claims, audit) are asserted end-to-end by the full-stack
  // scripts/phase1-acceptance.mjs (needs governance-graph-api + audit-service +
  // seeded Postgres). This smoke stays hermetic: operational + verify/hash only.

  const vr = await fetch(`${BASE}/api/v1/verify/hash`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'demo' }),
  });
  const vbody = await vr.json();
  assert('POST /api/v1/verify/hash → ok=true', vbody.ok === true, JSON.stringify(vbody));

  console.log('[v1-smoke] all checks passed');
} catch (err) {
  failed = true;
  console.error(`[v1-smoke] FAIL: ${err.message}`);
} finally {
  // Reap the child fully before exit so no orphan lingers on PORT.
  if (svc.exitCode === null && !svc.signalCode) {
    svc.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise((res) => svc.once('exit', () => res(true))),
      new Promise((res) => setTimeout(() => res(false), 2000)),
    ]);
    if (!exited) {
      try {
        svc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

if (failed) process.exit(1);

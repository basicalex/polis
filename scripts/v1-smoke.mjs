// v1 smoke test: asserts status + body shape on the §23 public BFF paths and
// verifies that document-signing-service exposes its operational health route.
// Self-builds the workspace when either service dist is missing, then starts
// both route tables in fixture mode and exits non-zero on any mismatch.
import { existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const PORT = Number(process.env.PLATFORM_API_PORT ?? 8080);
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = 'services/platform-api/dist/index.js';
const SIGNING_PORT = Number(process.env.DOCUMENT_SIGNING_SERVICE_PORT ?? 8960);
const SIGNING_BASE = `http://127.0.0.1:${SIGNING_PORT}`;
const SIGNING_DIST = 'services/document-signing-service/dist/index.js';

function assert(label, cond, detail = '') {
  if (!cond) throw new Error(`smoke failed: ${label} ${detail}`.trim());
  console.log(`  ok  ${label}`);
}

async function poll(base, label, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${label} did not become ready`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

if (!existsSync(DIST) || !existsSync(SIGNING_DIST)) {
  console.log('[v1-smoke] dist missing — building workspace…');
  execSync('bun run build', { stdio: 'inherit' });
}

// Fixture mode: no DATABASE_URL → runMigrationsOnce is caught, fixtures served.
const svc = spawn('node', [DIST], { stdio: ['ignore', 'pipe', 'pipe'] });
svc.stdout.on('data', (d) => process.stderr.write(d));
svc.stderr.on('data', (d) => process.stderr.write(d));

// The signing route table can serve operational routes without a database.
// Bind it with inert dependencies so this smoke remains hermetic.
const [{ signingRoutes }, { startService }] = await Promise.all([
  import('../services/document-signing-service/dist/index.js'),
  import('../packages/service-runtime/dist/index.js'),
]);
const signingSvc = startService('document-signing-service', SIGNING_PORT, signingRoutes({}));

let failed = false;
try {
  await Promise.all([poll(BASE, 'platform-api'), poll(SIGNING_BASE, 'document-signing-service')]);
  console.log('[v1-smoke] checking §23 contract…');

  const hz = await (await fetch(`${BASE}/healthz`)).json();
  assert('GET /healthz → status=ok', hz.status === 'ok', JSON.stringify(hz));
  const signingHealth = await (await fetch(`${SIGNING_BASE}/healthz`)).json();
  assert(
    'document-signing-service GET /healthz → status=ok',
    signingHealth.status === 'ok',
    JSON.stringify(signingHealth),
  );

  const ver = await (await fetch(`${BASE}/version`)).json();
  assert(
    'GET /version → version present',
    typeof ver.version === 'string' && ver.version.length > 0,
  );
  assert('GET /version → gitSha present', 'gitSha' in ver);

  // platform-api is the §23 proxy edge; the governance body shapes (institutions,
  // roles, processes, claims, audit) are asserted end-to-end by the full-stack
  // scripts/phase1-acceptance.mjs (needs governance-graph-api + audit-service +
  // seeded Postgres). This smoke stays hermetic: operational + verify/hash route
  // presence only. Since M3, /api/v1/verify/hash is proxied to proof-service
  // (PROOF_INTERNAL_URL); in hermetic smoke no proof-service runs, so the route
  // responds 502 bad_gateway — proving the proxy wiring is in place without
  // requiring the upstream. The valid/not_found behaviour is asserted by
  // scripts/phase3-acceptance.mjs against a live stack.

  const vr = await fetch(`${BASE}/api/v1/verify/hash`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash: 'deadbeef' }),
  });
  const vbody = await vr.json();
  assert(
    'POST /api/v1/verify/hash route present + proxied (502 bad_gateway in hermetic smoke)',
    vr.status === 502 && vbody.error === 'bad_gateway',
    `status=${vr.status} body=${JSON.stringify(vbody)}`,
  );

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
  await new Promise((resolve) => signingSvc.close(resolve));
}

if (failed) process.exit(1);

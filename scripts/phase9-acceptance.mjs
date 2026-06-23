// Phase 9 (M9) acceptance: exercises the §30.10 first-public-pilot contract
// end-to-end against a running stack (platform-api BFF :8080, all internal
// services, seeded Postgres, web app :4321).
//
// Verifies the three §30.10 acceptance criteria + regression:
//   1.  Pilot has public scope and sunset — charter published.
//   2.  Measurable outcome published — results report.
//   3.  Partner cannot suppress results outside pre-agreed redactions.
//   4.  Live issue map — issues reachable.
//   5.  Deliberation connected — issue linked to Polis conversation.
//   6.  Web pages reachable — charter + results pages.
//   7.  Health regression — all 16 services healthy.
//   8.  Policy tests pass — pilot redaction Rego.

import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const WEB = process.env.WEB_URL ?? 'http://localhost:4321';

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label} ${detail}`);
  } else {
    console.log(`  ok  ${label}`);
  }
}
async function get(base, path, headers = {}) {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function post(base, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function del(base, path, headers = {}) {
  const r = await fetch(base + path, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...headers },
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function patch(base, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}


console.log('[phase9] checking §30.10 first-public-pilot contract…');

// ─── 1. Charter published (criterion 1: public scope + sunset) ───
const charter = await get(BFF, '/api/v1/pilot/charter');
check('GET /api/v1/pilot/charter → 200', charter.status === 200, `status=${charter.status}`);
check('charter has partner', typeof charter.body?.partner === 'string' && charter.body.partner.length > 0);
check('charter has jurisdiction', typeof charter.body?.jurisdiction === 'string');
check('charter has scope', typeof charter.body?.scope === 'string' && charter.body.scope.length > 0);
check(
  'charter sunsetDate is valid ISO',
  typeof charter.body?.sunsetDate === 'string' && !isNaN(Date.parse(charter.body.sunsetDate)),
);
check(
  'charter sunset is in the future',
  charter.body?.sunsetDate && new Date(charter.body.sunsetDate).getTime() > Date.now(),
);
check('charter has successMetrics array', Array.isArray(charter.body?.successMetrics));
check('charter has redactionPolicy', typeof charter.body?.redactionPolicy === 'string');

// ─── 2. Measurable outcome published (criterion 2) ───
const results = await get(BFF, '/api/v1/pilot/results');
check('GET /api/v1/pilot/results → 200', results.status === 200, `status=${results.status}`);
const metrics = results.body?.metrics;
check(
  'results.metrics has ≥1 numeric value',
  metrics && Object.values(metrics).some((v) => typeof v === 'number'),
);
check('results.outcomes is array len≥1', Array.isArray(results.body?.outcomes) && results.body.outcomes.length >= 1);
check(
  'results.methodology is non-empty string',
  typeof results.body?.methodology === 'string' && results.body.methodology.length > 0,
);

// ─── 3. Partner cannot suppress results (criterion 3) ───
const deleteRes = await del(BFF, '/api/v1/pilot/results');
check('DELETE /api/v1/pilot/results → 404', deleteRes.status === 404, `status=${deleteRes.status}`);
const patchRes = await patch(BFF, '/api/v1/pilot/results', { redact: true });
check('PATCH /api/v1/pilot/results → 404', patchRes.status === 404, `status=${patchRes.status}`);
const resultsAfter = await get(BFF, '/api/v1/pilot/results');
check('GET /api/v1/pilot/results still → 200 after delete attempt', resultsAfter.status === 200);

// ─── 4. Live issue map ───
const issues = await get(BFF, '/api/v1/issues');
check('GET /api/v1/issues → 200', issues.status === 200, `status=${issues.status}`);
check('issues has ≥1 item', Array.isArray(issues.body?.items) && issues.body.items.length >= 1);
const deliberatingIssue = (issues.body?.items ?? []).find((i) => i.status === 'deliberating');
check('at least one issue is deliberating', !!deliberatingIssue);

// ─── 5. Deliberation connected ───
if (deliberatingIssue) {
  const issueDetail = await get(BFF, '/api/v1/issues/' + deliberatingIssue.id);
  check('GET /api/v1/issues/:id → 200', issueDetail.status === 200, `status=${issueDetail.status}`);
  check(
    'issue has conversation.externalPolisId',
    typeof issueDetail.body?.conversation?.externalPolisId !== 'undefined',
    `conv=${JSON.stringify(issueDetail.body?.conversation)?.slice(0, 60)}`,
  );
  const conv = await get(BFF, '/api/v1/issues/' + deliberatingIssue.id + '/conversation');
  check('GET /api/v1/issues/:id/conversation → 200', conv.status === 200, `status=${conv.status}`);
} else {
  check('deliberation issue detail (skipped — no deliberating issue)', false);
}

// ─── 6. Web pages reachable (requires web app on :4321) ───
try {
  const partnersPage = await fetch(WEB + '/partners');
  const partnersBody = partnersPage.ok ? await partnersPage.text() : '';
  check('GET /partners → 200', partnersPage.status === 200, `status=${partnersPage.status}`);
  check(
    '/partners body contains partner name',
    partnersBody.includes('Grad Primjer'),
    'partner name not in body',
  );

  const resultsPage = await fetch(WEB + '/pilot/results');
  const resultsBody = resultsPage.ok ? await resultsPage.text() : '';
  check('GET /pilot/results → 200', resultsPage.status === 200, `status=${resultsPage.status}`);
  check('/pilot/results body contains "Metrics"', resultsBody.includes('Metrics'));

  const homePage = await fetch(WEB + '/');
  const homeBody = homePage.ok ? await homePage.text() : '';
  check('GET / → 200', homePage.status === 200, `status=${homePage.status}`);
  check('/ body contains pilot card', homeBody.includes('Pilot'));
} catch (err) {
  check('web app reachable on :4321', false, `${err instanceof Error ? err.message : err}`);
}

// ─── 7. Health regression — all 16 services /healthz ───
const services = [
  ['governance-graph-api', 8100],
  ['audit-service', 8600],
  ['polis-bridge-service', 8200],
  ['paperless-adapter', 8300],
  ['canonicalization-service', 8500],
  ['signature-service', 8900],
  ['timestamp-service', 8800],
  ['proof-service', 8700],
  ['document-ingestion-gateway', 8400],
  ['contribution-service', 8450],
  ['rewards-service', 8460],
  ['citizen-identity-service', 8650],
  ['citizen-vault-service', 8750],
  ['vc-issuer-service', 8950],
  ['platform-api', 8080],
  ['ai-gateway', 8550],
];
for (const [name, port] of services) {
  try {
    const h = await get(`http://localhost:${port}`, '/healthz');
    check(`${name} /healthz ok`, h.body?.status === 'ok', `status=${h.status}`);
  } catch (err) {
    check(`${name} /healthz ok`, false, `${err instanceof Error ? err.message : err}`);
  }
}

// ─── 8. Policy tests pass ───
try {
  execSync('node --test test/policy.test.mjs', {
    cwd: join(repoRoot, 'packages/policy-rules'),
    stdio: 'pipe',
  });
  check('policy tests (including pilot redaction) pass', true);
} catch (err) {
  check('policy tests (including pilot redaction) pass', false, `${err instanceof Error ? err.message : err}`);
}

console.log(`[phase9] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

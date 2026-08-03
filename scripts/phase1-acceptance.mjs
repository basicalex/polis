// Phase 1 (M1) acceptance: exercises the §23 contract end-to-end against a
// running stack (governance-graph-api :8100, audit-service :8600, platform-api
// :8080, seeded Postgres). Discovers ids from the API so it is seed-agnostic.
// Run AFTER `docker compose up -d --wait` + `bun run db:seed` (or dev-services).
const GRAPH = process.env.GRAPH_INTERNAL_URL ?? 'http://localhost:8100';
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label} ${detail}`);
  } else {
    console.log(`  ok  ${label}`);
  }
}
async function get(base, path) {
  const r = await fetch(base + path);
  return { status: r.status, body: r.ok ? await r.json() : null };
}

console.log('[phase1] checking §23 contract across services…');

// 1. institutions on BOTH the graph service and the BFF proxy
const graphInst = await get(GRAPH, '/api/v1/institutions');
const bffInst = await get(BFF, '/api/v1/institutions');
check(
  'graph /api/v1/institutions count >= 2',
  Array.isArray(graphInst.body?.items) && graphInst.body.items.length >= 2,
  `got ${graphInst.body?.items?.length}`,
);
check(
  'bff  /api/v1/institutions count >= 2',
  Array.isArray(bffInst.body?.items) && bffInst.body.items.length >= 2,
  `got ${bffInst.body?.items?.length}`,
);

// 2. institution detail returns roles[]
const instId = bffInst.body?.items?.[0]?.id;
check('resolved an institution id', !!instId);
const instDetail = await get(BFF, `/api/v1/institutions/${instId}`);
check(
  'institution detail has roles[]',
  Array.isArray(instDetail.body?.roles),
  `keys=${instDetail.body ? Object.keys(instDetail.body).join(',') : 'null'}`,
);

// 3. role detail has §11.3 fields (mandate, decisionRights)
const roleId = instDetail.body?.roles?.[0]?.id;
check('resolved a role id', !!roleId);
if (roleId) {
  const role = await get(BFF, `/api/v1/roles/${roleId}`);
  check(
    'role has §11.3 mandate + decisionRights',
    role.body && 'mandate' in role.body && 'decisionRights' in role.body,
    `keys=${role.body ? Object.keys(role.body).join(',') : 'null'}`,
  );
}

// 4. process detail has §11.4 requiredDocuments + steps
const procs = await get(BFF, '/api/v1/processes');
const procId = procs.body?.items?.[0]?.id;
check('resolved a process id', !!procId);
if (procId) {
  const proc = await get(BFF, `/api/v1/processes/${procId}`);
  check(
    'process has §11.4 steps + requiredDocuments',
    Array.isArray(proc.body?.steps) && Array.isArray(proc.body?.requiredDocuments),
    `keys=${proc.body ? Object.keys(proc.body).join(',') : 'null'}`,
  );
}

// 5. every claim has evidence OR unsupported_draft (never an invented 'unsupported' state)
const claims = await get(BFF, '/api/v1/claims');
const claimItems = claims.body?.items ?? [];
check('at least 3 claims', claimItems.length >= 3, `got ${claimItems.length}`);
const badClaims = claimItems.filter((c) => {
  const hasEvidence = Array.isArray(c.evidence) && c.evidence.length > 0;
  const isUnsupportedDraft = c.confidenceState === 'unsupported_draft';
  const inventedUnsupported = c.reviewState === 'unsupported';
  return (!hasEvidence && !isUnsupportedDraft) || inventedUnsupported;
});
check(
  'every claim sourced OR unsupported_draft; never invented unsupported',
  badClaims.length === 0,
  `${badClaims.length} bad: ${JSON.stringify(badClaims.map((c) => ({ id: c.id, conf: c.confidenceState, rev: c.reviewState, ev: c.evidence?.length })))}`,
);

// 6. audit read returns public, redacted-shaped rows (append-only is structural)
const audit = await get(BFF, `/api/v1/audit/institution/${instId}`);
check(
  'audit read returns items[]',
  Array.isArray(audit.body?.items),
  `status=${audit.status} keys=${audit.body ? Object.keys(audit.body).join(',') : 'null'}`,
);
if (audit.body?.items?.length) {
  const ev0 = audit.body.items[0];
  check(
    'audit row has §26.3 shape (actorType/action/hash)',
    'actorType' in ev0 && 'action' in ev0 && 'hash' in ev0,
    `keys=${Object.keys(ev0).join(',')}`,
  );
  const allPublic = audit.body.items.every((e) => e.visibility === 'public');
  check('audit read returns only public rows', allPublic);
}

console.log(`[phase1] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

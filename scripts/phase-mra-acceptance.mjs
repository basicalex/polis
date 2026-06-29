// M-RA Phase 1 acceptance: read-only public mandate-holder layer.
// Exercises the four public BFF read routes against a running stack
// (platform-api BFF :8080 + governance-graph-api + seeded Postgres).
//
// Verifies the Phase 1 contract — strictly read-only:
//   1. GET /api/v1/mandate-holders → 200 + contains the seeded holder (mh-demo).
//   2. GET /api/v1/mandate-holders/mh-demo → 200 + charterAccepted + ≥2 commitments.
//   3. GET /api/v1/commitments/c-mh-1 → 200 + status timeline whose latest event is `delivered`.
//   4. GET /api/v1/mandate-holders/mh-demo/scorecard → 200 + counts only (no grade/score/rank).
//
// No writes, no auth. Run with: node scripts/dev-services.mjs then this script.

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

async function get(path) {
  const r = await fetch(BFF + path);
  return { status: r.status, body: r.ok ? await r.json() : null };
}

console.log('[phase-mra] checking M-RA Phase 1 read-only public layer…');

// ─── 1. Mandate-holder list ───
const list = await get('/api/v1/mandate-holders');
check('GET /api/v1/mandate-holders → 200', list.status === 200, `status=${list.status}`);
check(
  'list contains mh-demo',
  Array.isArray(list.body?.items) && list.body.items.some((h) => h.id === 'mh-demo'),
);

// ─── 2. Mandate-holder detail ───
const detail = await get('/api/v1/mandate-holders/mh-demo');
check(
  'GET /api/v1/mandate-holders/mh-demo → 200',
  detail.status === 200,
  `status=${detail.status}`,
);
check('holder charterAccepted === true', detail.body?.charterAccepted === true);
check(
  'holder has ≥2 commitments',
  Array.isArray(detail.body?.commitments) && detail.body.commitments.length >= 2,
  `count=${detail.body?.commitments?.length ?? 0}`,
);

// ─── 3. Commitment detail + status timeline ───
const commitment = await get('/api/v1/commitments/c-mh-1');
check(
  'GET /api/v1/commitments/c-mh-1 → 200',
  commitment.status === 200,
  `status=${commitment.status}`,
);
const timeline = commitment.body?.statusTimeline;
check(
  'status timeline is a non-empty array',
  Array.isArray(timeline) && timeline.length > 0,
  `len=${timeline?.length ?? 0}`,
);
check(
  'latest timeline event is delivered',
  Array.isArray(timeline) && timeline.length > 0 && timeline[0].status === 'delivered',
  `latest=${timeline?.[0]?.status ?? 'none'}`,
);
check(
  'resolved commitment has resolution evidence',
  commitment.body?.resolution !== null && commitment.body?.resolution !== undefined,
);

// ─── 4. Scorecard (counts only, no grade/score/rank) ───
const scorecard = await get('/api/v1/mandate-holders/mh-demo/scorecard');
check(
  'GET /api/v1/mandate-holders/mh-demo/scorecard → 200',
  scorecard.status === 200,
  `status=${scorecard.status}`,
);
const totals = scorecard.body?.totals;
check(
  'scorecard totals.delivered === 1',
  totals?.delivered === 1,
  `delivered=${totals?.delivered}`,
);
check(
  'scorecard totals.inProgress === 1',
  totals?.inProgress === 1,
  `inProgress=${totals?.inProgress}`,
);
const forbiddenScoreFields = ['grade', 'score', 'rank', 'ranking'];
const presentForbidden = forbiddenScoreFields.filter((k) => k in (scorecard.body ?? {}));
check(
  'scorecard has NO grade/score/rank field',
  presentForbidden.length === 0,
  `found=${presentForbidden.join(',')}`,
);

console.log(`[phase-mra] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

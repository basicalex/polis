import { loginCitizen } from './dev-login.mjs';

// M-RA Phase 3 acceptance: commitment-scoped Q&A + scorecard deep-links.
// Exercises the Phase 3 critical path end-to-end against a running stack
// (platform-api BFF :8080 + citizen-identity-service :8650 + contribution-service
// :8450 + governance-graph-api + seeded Postgres, IDENTITY_DEV_TOKENS=true).
//
// Verifies the Phase 3 contract:
//   1.  verified_official + verified_resident logins (identity levels preserved).
//   2.  Citizen ask → 201 published question.
//   3.  Public read of the question (answer===null) + projection (commitment.questions).
//   4.  Official answer → 201 pending mandate_answer submission.
//   5.  Admin approve answer → applied=true; answer now readable.
//   6.  Auth gate — unauthenticated ask → 401.
//   7.  Access gate — verified_resident answering → 403 not_verified_official.
//   8.  Scorecard counts still served (deep-link surface verified by build + manual).
//
// Run with: bun scripts/dev-services.mjs (fresh seed) then bun scripts/phase-mra3-acceptance.mjs

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
// Parse JSON on every status (incl. non-2xx) so 401/403 bodies can be inspected.
async function get(base, path, headers = {}) {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(base, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

console.log('[phase-mra3] checking M-RA Phase 3 commitment-scoped Q&A + scorecard deep-links…');

// ─── 1-2. Logins ───
const MH_EMAIL = 'mandate-holder-demo@polis.local';
const mhLogin = await loginCitizen(BFF, MH_EMAIL);
check('mandate-holder magic-link + exchange → 200', !mhLogin.error, mhLogin.error ?? '');
check(
  'mandate-holder identityLevel === verified_official',
  mhLogin.citizen?.identityLevel === 'verified_official',
  `level=${mhLogin.citizen?.identityLevel ?? mhLogin.error}`,
);
const mhAuth = { authorization: 'Bearer ' + mhLogin.sessionToken };

const residentEmail = 'ra-' + Date.now() + '@test.local';
const resLogin = await loginCitizen(BFF, residentEmail);
check('resident magic-link + exchange → 200', !resLogin.error, resLogin.error ?? '');
check(
  'resident identityLevel === verified_resident',
  resLogin.citizen?.identityLevel === 'verified_resident',
  `level=${resLogin.citizen?.identityLevel ?? resLogin.error}`,
);
const residentAuth = { authorization: 'Bearer ' + resLogin.sessionToken };
const reviewerLogin = await loginCitizen(BFF, 'reviewer-demo@polis.local');
check('staff reviewer login succeeds', !reviewerLogin.error, reviewerLogin.error ?? '');
check('reviewer identityLevel === staff', reviewerLogin.citizen?.identityLevel === 'staff');
const reviewerAuth = { authorization: 'Bearer ' + reviewerLogin.sessionToken };
const reviewQueue = await get(BFF, '/api/v1/review/queue', reviewerAuth);
check(
  'staff GET /api/v1/review/queue → 200',
  reviewQueue.status === 200,
  `status=${reviewQueue.status}`,
);

// ─── 3. Citizen ask on c-mh-2 ───
const ask = await post(
  BFF,
  '/api/v1/commitments/c-mh-2/questions',
  { body: 'Phase3: when does c-mh-2 land?' },
  residentAuth,
);
check('POST /commitments/c-mh-2/questions → 201', ask.status === 201, `status=${ask.status}`);
const qId = ask.body?.id;
check('asked question has an id', typeof qId === 'string', `id=${qId}`);

// ─── 4. Public read (answer===null) ───
const pubRead = await get(BFF, '/api/v1/commitments/c-mh-2/questions');
check(
  'GET /commitments/c-mh-2/questions → 200',
  pubRead.status === 200,
  `status=${pubRead.status}`,
);
const asked = Array.isArray(pubRead.body?.items)
  ? pubRead.body.items.find((q) => q.id === qId)
  : null;
check('public read includes the new question', !!asked, 'question missing');
check(
  'new question answer === null',
  asked?.answer === null,
  `answer=${JSON.stringify(asked?.answer)}`,
);

// ─── 5. Projection (commitment detail carries questions) ───
const detail = await get(BFF, '/api/v1/commitments/c-mh-2');
check('GET /commitments/c-mh-2 → 200', detail.status === 200, `status=${detail.status}`);
check(
  'commitment detail includes the question (projection)',
  Array.isArray(detail.body?.questions) && detail.body.questions.some((q) => q.id === qId),
  `present=${Array.isArray(detail.body?.questions) && detail.body.questions.some((q) => q.id === qId)}`,
);

// ─── 6. Official answer (mandate owner) ───
const answer = await post(
  BFF,
  '/api/v1/commitment-questions/' + qId + '/answers',
  { body: 'On schedule.' },
  mhAuth,
);
check(
  'POST /commitment-questions/:id/answers → 201',
  answer.status === 201,
  `status=${answer.status}`,
);
check(
  'filed answer status === pending',
  answer.body?.status === 'pending',
  `status=${answer.body?.status}`,
);
check(
  'filed answer contributionClass === mandate_answer',
  answer.body?.contributionClass === 'mandate_answer',
  `class=${answer.body?.contributionClass}`,
);
const sub = answer.body?.id;

// ─── 7. Admin approve answer ───
const approve = await post(
  BFF,
  '/api/v1/review/' + sub + '/decide',
  { decision: 'approve', notes: 'M-RA3 answer approval' },
  reviewerAuth,
);
check('POST /review/:id/decide → 201', approve.status === 201, `status=${approve.status}`);
check(
  'answer applied === true',
  approve.body?.applied === true,
  `applied=${approve.body?.applied}`,
);

// ─── 8. Answer now readable ───
const pubRead2 = await get(BFF, '/api/v1/commitments/c-mh-2/questions');
const answered = Array.isArray(pubRead2.body?.items)
  ? pubRead2.body.items.find((q) => q.id === qId)
  : null;
check(
  'applied answer body === "On schedule."',
  answered?.answer?.body === 'On schedule.',
  `answer=${JSON.stringify(answered?.answer)}`,
);

// ─── 9. Answer access gate (verified_resident, not the mandate owner) ───
const denied = await post(
  BFF,
  '/api/v1/commitment-questions/' + qId + '/answers',
  { body: 'should be rejected' },
  residentAuth,
);
check('resident POST answer → 403', denied.status === 403, `status=${denied.status}`);
check(
  'resident denied with not_verified_official',
  denied.body?.error === 'not_verified_official',
  `error=${denied.body?.error}`,
);

// ─── 10. Ask auth gate (no auth) ───
const noAuth = await post(BFF, '/api/v1/commitments/c-mh-2/questions', { body: 'no auth' });
check('POST ask without auth → 401', noAuth.status === 401, `status=${noAuth.status}`);

// ─── 11. Scorecard counts still served (deep-link surface present) ───
// The deep-link itself (?status=delivered) is server-rendered HTML on apps/web;
// it is verified by `bun run --filter @polis/apps-web build` + a manual visit. Here
// we assert the API the cells are built from still returns counts.
const scorecard = await get(BFF, '/api/v1/mandate-holders/mh-demo/scorecard');
check(
  'GET /mandate-holders/mh-demo/scorecard → 200',
  scorecard.status === 200,
  `status=${scorecard.status}`,
);
check(
  'scorecard returns totals',
  !!scorecard.body?.totals && typeof scorecard.body.totals.delivered === 'number',
  `totals=${JSON.stringify(scorecard.body?.totals)}`,
);

console.log(`[phase-mra3] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

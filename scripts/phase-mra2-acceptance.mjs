// M-RA Phase 2 acceptance: citizen-authenticated mandate write/review path.
// Exercises the Phase 2 critical path end-to-end against a running stack
// (platform-api BFF :8080 + citizen-identity-service :8650 + contribution-service
// :8450 + governance-graph-api + seeded Postgres, IDENTITY_DEV_TOKENS=true).
//
// Verifies the Phase 2 contract:
//   1.  verified_official login (identity level preserved for the seeded citizen).
//   2.  File commitment → 201 pending mandate_commitment submission.
//   3.  Admin approve commitment → applied=true; commitment now readable (≥3).
//   4.  File resolution → 201 pending.
//   5.  Admin approve resolution → applied=true; status event latest=delivered.
//   6.  Auth gate — unauthenticated → 401.
//   7.  Access gate — fresh verified_resident (non-owner) → 403 not_verified_official.
//
// Run with: node scripts/dev-services.mjs (fresh seed) then node scripts/phase-mra2-acceptance.mjs

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

// magic-link → dev-token → exchange. Returns { auth, citizen } or { error }.
// Requires IDENTITY_DEV_TOKENS=true on identity-service.
async function citizenLogin(email) {
  const ml = await post(BFF, '/api/v1/identity/magic-link', { email });
  if (ml.status !== 200) return { error: `magic-link ${ml.status}` };
  const dt = await get(BFF, '/api/v1/identity/dev-tokens');
  const token = dt.body?.tokens?.[email];
  if (typeof token !== 'string') return { error: 'no dev token' };
  const ex = await post(BFF, '/api/v1/identity/exchange', { email, token });
  if (ex.status !== 200) return { error: `exchange ${ex.status}` };
  return {
    auth: { authorization: 'Bearer ' + ex.body.sessionToken },
    citizen: ex.body.citizen,
  };
}

console.log('[phase-mra2] checking M-RA Phase 2 citizen-authenticated mandate write/review path…');

// ─── 1-3. verified_official login (seeded mandate-holder-demo) ───
const MH_EMAIL = 'mandate-holder-demo@polis.local';
const mhLogin = await citizenLogin(MH_EMAIL);
check('mandate-holder magic-link + exchange → 200', !mhLogin.error, mhLogin.error ?? '');
check(
  'mandate-holder identityLevel === verified_official',
  mhLogin.citizen?.identityLevel === 'verified_official',
  `level=${mhLogin.citizen?.identityLevel ?? mhLogin.error}`,
);
const mhAuth = mhLogin.auth;

// ─── 4. File commitment ───
const fileCommitment = await post(
  BFF,
  '/api/v1/mandate-holders/mh-demo/commitments',
  {
    claimId: 'claim-mh-promise-1',
    successCriterion: 'Phase2 acceptance: once-only checklist v2.',
    dueAt: '2027-06-01T00:00:00Z',
  },
  mhAuth,
);
check(
  'POST /mandate-holders/mh-demo/commitments → 201',
  fileCommitment.status === 201,
  `status=${fileCommitment.status}`,
);
check(
  'filed commitment status === pending',
  fileCommitment.body?.status === 'pending',
  `status=${fileCommitment.body?.status}`,
);
check(
  'filed commitment contributionClass === mandate_commitment',
  fileCommitment.body?.contributionClass === 'mandate_commitment',
  `class=${fileCommitment.body?.contributionClass}`,
);
const sub1 = fileCommitment.body?.id;

// ─── 5. Admin approve commitment ───
const approveCommitment = await post(BFF, '/api/v1/review/' + sub1 + '/decide', {
  reviewerRole: 'reviewer',
  reviewerId: 'reviewer-demo',
  decision: 'approve',
});
check(
  'POST /review/' + sub1 + '/decide → 201',
  approveCommitment.status === 201,
  `status=${approveCommitment.status}`,
);
check(
  'commitment applied === true',
  approveCommitment.body?.applied === true,
  `applied=${approveCommitment.body?.applied}`,
);

// ─── 6. Commitment now readable (seed has 2; this filed the 3rd) ───
const mhDetail = await get(BFF, '/api/v1/mandate-holders/mh-demo');
check('GET /mandate-holders/mh-demo → 200', mhDetail.status === 200, `status=${mhDetail.status}`);
check(
  'holder now has ≥3 commitments',
  Array.isArray(mhDetail.body?.commitments) && mhDetail.body.commitments.length >= 3,
  `count=${mhDetail.body?.commitments?.length ?? 0}`,
);

// ─── 7. File resolution against seeded c-mh-2 (still in_progress) ───
const fileResolution = await post(
  BFF,
  '/api/v1/commitments/c-mh-2/resolutions',
  { status: 'delivered', resolutionClaimId: 'claim-mh-resolution-1' },
  mhAuth,
);
check(
  'POST /commitments/c-mh-2/resolutions → 201',
  fileResolution.status === 201,
  `status=${fileResolution.status}`,
);
check(
  'filed resolution status === pending',
  fileResolution.body?.status === 'pending',
  `status=${fileResolution.body?.status}`,
);
const sub2 = fileResolution.body?.id;

// ─── 8. Admin approve resolution ───
const approveResolution = await post(BFF, '/api/v1/review/' + sub2 + '/decide', {
  reviewerRole: 'reviewer',
  reviewerId: 'reviewer-demo',
  decision: 'approve',
});
check(
  'POST /review/' + sub2 + '/decide → 201',
  approveResolution.status === 201,
  `status=${approveResolution.status}`,
);
check(
  'resolution applied === true',
  approveResolution.body?.applied === true,
  `applied=${approveResolution.body?.applied}`,
);

// ─── 9. Status event applied (latest timeline event = delivered) ───
const c2 = await get(BFF, '/api/v1/commitments/c-mh-2');
check('GET /commitments/c-mh-2 → 200', c2.status === 200, `status=${c2.status}`);
check(
  'latest status timeline event is delivered',
  Array.isArray(c2.body?.statusTimeline) &&
    c2.body.statusTimeline.length > 0 &&
    c2.body.statusTimeline[0].status === 'delivered',
  `latest=${c2.body?.statusTimeline?.[0]?.status ?? 'none'}`,
);

// ─── 10. Auth gate — unauthenticated → 401 ───
const noAuth = await post(BFF, '/api/v1/mandate-holders/mh-demo/commitments', {
  claimId: 'claim-mh-promise-1',
  successCriterion: 'x',
});
check('POST commitment without auth → 401', noAuth.status === 401, `status=${noAuth.status}`);

// ─── 11. Access gate — fresh verified_resident (non-owner) → 403 not_verified_official ───
const residentEmail = 'ra-' + Date.now() + '@test.local';
const resLogin = await citizenLogin(residentEmail);
check('resident magic-link + exchange → 200', !resLogin.error, resLogin.error ?? '');
check(
  'resident identityLevel === verified_resident',
  resLogin.citizen?.identityLevel === 'verified_resident',
  `level=${resLogin.citizen?.identityLevel ?? resLogin.error}`,
);
const resDenied = await post(
  BFF,
  '/api/v1/mandate-holders/mh-demo/commitments',
  { claimId: 'claim-mh-promise-1', successCriterion: 'x' },
  resLogin.auth,
);
check('resident POST commitment → 403', resDenied.status === 403, `status=${resDenied.status}`);
check(
  'resident denied with not_verified_official',
  resDenied.body?.error === 'not_verified_official',
  `error=${resDenied.body?.error}`,
);

console.log(`[phase-mra2] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

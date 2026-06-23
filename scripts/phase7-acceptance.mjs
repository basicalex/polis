// Phase 7 (M7) acceptance: exercises the §30.8 civic-rewards prototype
// end-to-end against a running stack (rewards-service :8460, contribution-service
// :8450, platform-api BFF :8080, seeded Postgres).
//
// Verifies the four §30.8 acceptance criteria + deliverables:
//   1.  Approved non-political contribution → reward eligibility (eligible).
//   2.  Audit trail — reward.eligibility.created emitted.
//   3.  Public aggregate ledger is public + readable.
//   4.  Privacy — ledger has no personal data; payouts unreachable publicly.
//   5.  Political agreement is NOT rewardable (no eligibility row).
//   6.  Reward rules are public.
//   7.  Manual payout export (internal-only) + privacy.
//   8.  Anti-spam monthly cap denies the (cap+1)th eligibility.
//   9.  rewards-service /healthz ok.
//
// Run AFTER `docker compose up -d --build --wait` and the seed.
const CONTRIB = process.env.CONTRIBUTION_INTERNAL_URL ?? 'http://localhost:8450';
const REWARDS = process.env.REWARDS_INTERNAL_URL ?? 'http://localhost:8460';
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
  return { status: r.status, body: r.ok ? await r.json() : null, text: r.ok ? '' : '' };
}
async function post(base, path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function submitAndApproveCivic(opts) {
  const { contributorId, displayName } = opts;
  const sub = await post(BFF, '/api/v1/contribute/evidence', {
    // identity gate requires contributor.identityLevel on every submit (mock
    // identity); contributorId reuses an existing contributor when present.
    contributor: { displayName, identityLevel: 'verified' },
    contributorId,
    payload: {
      text: `M7 acceptance ${displayName} #${Math.random().toString(36).slice(2, 8)}`,
      claimType: 'document_requirement',
      subjectType: 'process_step',
      subjectId: 'step-registry-validation',
      confidence: 0.8,
      contributionClass: 'civic',
    },
  });
  if (sub.status !== 201) return null;
  const id = sub.body.id;
  const cid = sub.body.contributorId;
  const decide = await post(CONTRIB, '/internal/review/' + id + '/decide', {
    reviewerRole: 'reviewer',
    reviewerId: 'rev-m7',
    decision: 'approve',
  });
  if (decide.status !== 201) return null;
  return { submissionId: id, contributorId: cid, approved: decide.body };
}

console.log('[phase7] checking §30.8 civic-rewards prototype…');

// 6. Reward rules (read first so the cap loop tracks the configured cap).
const rules = await get(BFF, '/api/v1/rewards/rules');
check('GET /api/v1/rewards/rules → 200', rules.status === 200, `status=${rules.status}`);
check(
  'rules politicalAgreementRewardable false',
  rules.body?.politicalAgreementRewardable === false,
  `val=${rules.body?.politicalAgreementRewardable}`,
);
check(
  'rules monthlyCap is a number > 0',
  typeof rules.body?.monthlyCap === 'number' && rules.body.monthlyCap > 0,
  `val=${rules.body?.monthlyCap}`,
);
check(
  'rules amountPerEligibility is a number > 0',
  typeof rules.body?.amountPerEligibility === 'number' && rules.body.amountPerEligibility > 0,
  `val=${rules.body?.amountPerEligibility}`,
);
const CAP = Number(rules.body?.monthlyCap ?? 5);

// 1. Eligibility — approved civic contribution → eligible.
const alice = await submitAndApproveCivic({ displayName: 'Alice M7' });
check('submit + approve civic evidence (Alice) → 201', alice !== null);
const aliceSubId = alice?.submissionId ?? '';
const aliceContribId = alice?.contributorId ?? '';
const aliceElig = aliceSubId
  ? await get(REWARDS, '/internal/rewards/eligibility/' + aliceSubId)
  : { status: 0, body: null };
check(
  'GET /internal/rewards/eligibility/:id → 200',
  aliceElig.status === 200,
  `status=${aliceElig.status}`,
);
check(
  'approved civic → outcome eligible',
  aliceElig.body?.outcome === 'eligible',
  `outcome=${aliceElig.body?.outcome}`,
);
check(
  'eligible amount > 0',
  aliceElig.body?.amount != null && Number(aliceElig.body.amount) > 0,
  `amount=${aliceElig.body?.amount}`,
);
const eligibilityId = aliceElig.body?.id ?? '';

// 2. Audit trail.
const rewardAudit = eligibilityId
  ? await get(BFF, '/api/v1/audit/reward/' + eligibilityId)
  : { status: 0, body: null };
check(
  'GET /api/v1/audit/reward/:id → 200',
  rewardAudit.status === 200,
  `status=${rewardAudit.status}`,
);
const rewardAuditItems = rewardAudit.body?.items ?? [];
check(
  'audit contains reward.eligibility.created',
  Array.isArray(rewardAuditItems) &&
    rewardAuditItems.some((e) => e?.eventType === 'reward.eligibility.created'),
  `items=${JSON.stringify(rewardAuditItems).slice(0, 200)}`,
);

// 3. Public aggregate ledger.
const ledger = await get(BFF, '/api/v1/rewards/public-ledger');
check('GET /api/v1/rewards/public-ledger → 200', ledger.status === 200, `status=${ledger.status}`);
const ledgerItems = ledger.body?.items ?? [];
check(
  'ledger items is an array',
  Array.isArray(ledgerItems),
  `items=${JSON.stringify(ledgerItems).slice(0, 120)}`,
);
check(
  'ledger items shape {period, contributionClass, count, totalAmount}',
  ledgerItems.every(
    (i) =>
      typeof i?.period === 'string' &&
      typeof i?.contributionClass === 'string' &&
      typeof i?.count === 'number' &&
      typeof i?.totalAmount === 'string',
  ),
  `items=${JSON.stringify(ledgerItems).slice(0, 160)}`,
);
check(
  'ledger has a civic bucket with count >= 1',
  Array.isArray(ledgerItems) &&
    ledgerItems.some((i) => i.contributionClass === 'civic' && i.count >= 1),
  `items=${JSON.stringify(ledgerItems).slice(0, 160)}`,
);

// 4. Privacy — no personal data in ledger; payouts unreachable publicly.
const ledgerStr = JSON.stringify(ledgerItems);
check(
  'ledger contains no contributorId value',
  !aliceContribId || !ledgerStr.includes(aliceContribId),
  `contributorId=${aliceContribId}`,
);
check(
  'ledger contains no displayName',
  !ledgerStr.includes('Alice M7') && !ledgerStr.toLowerCase().includes('displayname'),
  `present=${ledgerStr.includes('Alice M7')}`,
);
check(
  'no ledger item has contributorId/displayName keys',
  ledgerItems.every((i) => !('contributorId' in i) && !('displayName' in i)),
  `items=${ledgerStr.slice(0, 160)}`,
);
const publicPayouts = await get(BFF, '/api/v1/rewards/payouts');
check(
  'GET /api/v1/rewards/payouts via BFF → 404 (no public payout route)',
  publicPayouts.status === 404,
  `status=${publicPayouts.status}`,
);

// 5. Political agreement is not rewardable.
const polSub = await post(BFF, '/api/v1/contribute/evidence', {
  contributor: { displayName: 'Carol M7', identityLevel: 'verified' },
  payload: {
    text: 'M7 acceptance: political agreement never rewardable',
    claimType: 'public_statement',
    subjectType: 'institution',
    subjectId: 'inst-complaints-office',
    confidence: 0.6,
    contributionClass: 'political_agreement',
  },
});
const polId = polSub.body?.id ?? '';
check(
  'submit political_agreement evidence → 201',
  polSub.status === 201,
  `status=${polSub.status}`,
);
const polDecide = polId
  ? await post(CONTRIB, '/internal/review/' + polId + '/decide', {
      reviewerRole: 'reviewer',
      reviewerId: 'rev-m7',
      decision: 'approve',
    })
  : { status: 0, body: null };
check(
  'political approve → 201 (held, applied false)',
  polDecide.status === 201 && polDecide.body?.applied === false,
  `status=${polDecide.status} applied=${polDecide.body?.applied}`,
);
const polElig = polId
  ? await get(REWARDS, '/internal/rewards/eligibility/' + polId)
  : { status: 0, body: null };
check(
  'political agreement has NO eligibility row → 404',
  polElig.status === 404,
  `status=${polElig.status}`,
);
const ledgerAfterPol = await get(BFF, '/api/v1/rewards/public-ledger');
const ledgerAfterPolItems = ledgerAfterPol.body?.items ?? [];
check(
  'ledger has NO political_agreement bucket',
  !ledgerAfterPolItems.some((i) => i.contributionClass === 'political_agreement'),
  `items=${JSON.stringify(ledgerAfterPolItems).slice(0, 160)}`,
);

// 7. Manual payout export (internal-only).
const export1 = await get(REWARDS, '/internal/rewards/payouts/export');
check(
  'GET /internal/rewards/payouts/export → 200',
  export1.status === 200,
  `status=${export1.status}`,
);
check(
  'export count >= 1',
  typeof export1.body?.count === 'number' && export1.body.count >= 1,
  `count=${export1.body?.count}`,
);
check(
  'export markedPaid === count',
  export1.body?.markedPaid === export1.body?.count,
  `markedPaid=${export1.body?.markedPaid} count=${export1.body?.count}`,
);
const exportCsv = export1.body?.csv ?? '';
check(
  'export csv has RFC 4180 header',
  exportCsv.startsWith('eligibility_id,contributor_id,display_name,amount,period'),
  `csv=${exportCsv.slice(0, 120)}`,
);
let daveContribId = '';
const eligibilities = [];
for (let i = 0; i < CAP + 1; i++) {
  const r = await submitAndApproveCivic({
    contributorId: daveContribId || undefined,
    displayName: 'Dave M7',
  });
  if (!r) {
    eligibilities.push(null);
    continue;
  }
  if (!daveContribId) daveContribId = r.contributorId;
  const elig = await get(REWARDS, '/internal/rewards/eligibility/' + r.submissionId);
  eligibilities.push(elig.body);
}
const outcomes = eligibilities.map((e) => e?.outcome ?? null);
check(
  `first ${CAP} Dave eligibilities are 'eligible'`,
  outcomes.slice(0, CAP).every((o) => o === 'eligible'),
  `outcomes=${JSON.stringify(outcomes)}`,
);
check(
  `Dave cap+1th eligibility is 'denied' (monthly_cap_reached)`,
  outcomes[CAP] === 'denied',
  `outcome=${outcomes[CAP]}`,
);
check(
  'Dave cap+1th denialReason is monthly_cap_reached',
  eligibilities[CAP]?.denialReason === 'monthly_cap_reached',
  `denialReason=${eligibilities[CAP]?.denialReason}`,
);

// 9. Health.
const health = await get(REWARDS, '/healthz');
check('rewards-service /healthz ok', health.body?.status === 'ok', `status=${health.status}`);

console.log(`[phase7] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

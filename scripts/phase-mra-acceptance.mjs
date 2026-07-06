// M-RA acceptance: representative accountability read + adjudication path.
// Exercises the public BFF against a running stack (platform-api :8080,
// contribution-service :8450, governance-graph-api :8100, seeded Postgres).
//
// Env knobs (boring names, no compose/.env dependency):
//   PUBLIC_API_URL         BFF base URL (default http://localhost:8080)
//   MRA_AUTH_TOKEN         Authorization header value for write flow; use first.
//                          May be either "Bearer <session>" or a raw session token.
//   MRA_SESSION_TOKEN      Raw session token fallback; sent as "Bearer <token>".
//   MRA_MANDATE_HOLDER_ID  Seed mandate-holder id (default mh-demo)
//   MRA_COMMITMENT_ID      Seed commitment id for resolution flow (default c-mh-2)
//   MRA_REVIEWER_ID        Reviewer id used for approval (default reviewer-demo)
//
// Verifies the M-RA Phase 2 contract:
//   1. Public reads: mandate-holder list/detail, scorecard, commitment detail.
//   2. Auth-gated official write flow uses only platform-api public routes.
//   3. Direct terminal-status write through commitment filing is rejected.
//   4. File commitment publishes/accepts a claim-backed commitment.
//   5. File resolution + review approval is the only terminal-status path.
//   6. Effective status changes and scorecard counts reflect the approved status.

const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const MANDATE_HOLDER_ID = process.env.MRA_MANDATE_HOLDER_ID ?? 'mh-demo';
const RESOLUTION_COMMITMENT_ID = process.env.MRA_COMMITMENT_ID ?? 'c-mh-2';
const REVIEWER_ID = process.env.MRA_REVIEWER_ID ?? 'reviewer-demo';

let failures = 0;

function check(label, cond, detail = '') {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` ${detail}` : ''}`);
  } else {
    console.log(`  ok  ${label}`);
  }
}

// Parse JSON on every status (including non-2xx) so rejection bodies are visible.
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

function authHeadersFromEnv() {
  const authToken = process.env.MRA_AUTH_TOKEN?.trim();
  if (authToken) {
    return { authorization: authToken.startsWith('Bearer ') ? authToken : 'Bearer ' + authToken };
  }
  const sessionToken = process.env.MRA_SESSION_TOKEN?.trim();
  if (sessionToken) return { authorization: 'Bearer ' + sessionToken };
  return null;
}

function extractSubmissionId(res) {
  const candidates = [res.body?.id, res.body?.submissionId, res.body?.submission?.id];
  return candidates.find((v) => typeof v === 'string' && v.length > 0) ?? '';
}

function extractCommitmentId(res) {
  const candidates = [res.body?.commitmentId, res.body?.commitment?.id, res.body?.id];
  return candidates.find((v) => typeof v === 'string' && v.length > 0) ?? '';
}

function totalTerminalCount(scorecard) {
  const t = scorecard.body?.totals ?? {};
  return Number(t.delivered ?? 0) + Number(t.partial ?? 0) + Number(t.notDelivered ?? 0);
}

function commitmentCount(holder) {
  return Array.isArray(holder.body?.commitments) ? holder.body.commitments.length : null;
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

function restrictedEvidenceFindings(publicBody) {
  const findings = { checked: 0, redacted: 0, leaks: [] };
  walk(publicBody, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const visibility = typeof value.visibility === 'string' ? value.visibility : '';
    if (!['restricted', 'private'].includes(visibility)) return;
    const hasEvidenceShape =
      'locator' in value || 'quote' in value || 'paraphrase' in value || 'sourceHash' in value;
    if (!hasEvidenceShape) return;
    findings.checked++;
    for (const field of ['locator', 'quote', 'paraphrase', 'sourceHash']) {
      const fieldValue = value[field];
      if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '[redacted]') {
        findings.leaks.push(field);
      }
    }
    if (findings.leaks.length === 0) findings.redacted++;
  });
  return findings;
}

console.log('[phase-mra] checking representative accountability read + adjudication path…');

// ─── 1. Public read path ───
const holders = await get(BFF, '/api/v1/mandate-holders');
check('GET /api/v1/mandate-holders → 200', holders.status === 200, `status=${holders.status}`);
const holderItems = Array.isArray(holders.body?.items) ? holders.body.items : [];
check(
  'mandate-holder list includes configured holder',
  holderItems.some((h) => h?.id === MANDATE_HOLDER_ID),
  `ids=${holderItems.map((h) => h?.id).filter(Boolean).join(',')}`,
);

const holderDetail = await get(BFF, '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID);
check('GET /api/v1/mandate-holders/:id → 200', holderDetail.status === 200, `status=${holderDetail.status}`);
check(
  'holder detail has commitments array',
  Array.isArray(holderDetail.body?.commitments),
  `keys=${holderDetail.body ? Object.keys(holderDetail.body).join(',') : 'null'}`,
);

const beforeScorecard = await get(BFF, '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID + '/scorecard');
check(
  'GET /api/v1/mandate-holders/:id/scorecard → 200',
  beforeScorecard.status === 200,
  `status=${beforeScorecard.status}`,
);
check(
  'scorecard is counts-only totals',
  !!beforeScorecard.body?.totals && typeof beforeScorecard.body.totals.delivered === 'number',
  `totals=${JSON.stringify(beforeScorecard.body?.totals)}`,
);
const terminalBefore = totalTerminalCount(beforeScorecard);

const seededCommitment = await get(BFF, '/api/v1/commitments/' + RESOLUTION_COMMITMENT_ID);
check('GET /api/v1/commitments/:id → 200', seededCommitment.status === 200, `status=${seededCommitment.status}`);
check(
  'commitment detail has effectiveStatus + statusTimeline',
  typeof seededCommitment.body?.effectiveStatus === 'string' && Array.isArray(seededCommitment.body?.statusTimeline),
  `body=${JSON.stringify(seededCommitment.body ?? {}).slice(0, 200)}`,
);

// ─── 2. Auth token required for write flow ───
const auth = authHeadersFromEnv();
check(
  'write-flow auth token present (set MRA_AUTH_TOKEN or MRA_SESSION_TOKEN)',
  !!auth,
  'action: export MRA_AUTH_TOKEN="Bearer <session>" or MRA_SESSION_TOKEN=<session> for a verified official',
);

if (auth) {
  // ─── 3. Negative: charter scope must cover requested jurisdiction/process ───
  const beforeDeniedHolder = await get(BFF, '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID);
  const beforeDeniedCommitmentCount = commitmentCount(beforeDeniedHolder);
  const deniedCommitment = await post(
    BFF,
    '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID + '/commitments',
    {
      text: 'M-RA acceptance must reject non-covering charter scope ' + Date.now(),
      successCriterion: 'This write must not create a commitment.',
      jurisdictionId: 'mra-acceptance-non-covering-jurisdiction',
      processId: 'mra-acceptance-non-covering-process',
    },
    auth,
  );
  check(
    'non-covering jurisdiction/process commitment filing is denied with 403',
    deniedCommitment.status === 403,
    `status=${deniedCommitment.status} body=${JSON.stringify(deniedCommitment.body ?? {}).slice(0, 200)}`,
  );
  check(
    'denied commitment response exposes no commitment id',
    !extractCommitmentId(deniedCommitment),
    `body=${JSON.stringify(deniedCommitment.body ?? {}).slice(0, 200)}`,
  );
  const afterDeniedHolder = await get(BFF, '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID);
  const afterDeniedCommitmentCount = commitmentCount(afterDeniedHolder);
  check(
    'denied commitment attempt creates no publicly readable holder commitment',
    beforeDeniedCommitmentCount !== null &&
      afterDeniedCommitmentCount !== null &&
      afterDeniedCommitmentCount === beforeDeniedCommitmentCount,
    `before=${beforeDeniedCommitmentCount} after=${afterDeniedCommitmentCount}`,
  );

  // ─── 3. Negative: terminal status cannot be self-declared during commitment filing ───
  const terminalCommitment = await post(
    BFF,
    '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID + '/commitments',
    {
      claimId: 'claim-mh-promise-1',
      successCriterion: 'M-RA acceptance must reject direct terminal status ' + Date.now(),
      status: 'delivered',
      effectiveStatus: 'delivered',
      terminalStatus: 'delivered',
    },
    auth,
  );
  check(
    'direct terminal-status commitment filing is rejected',
    terminalCommitment.status >= 400 && terminalCommitment.status < 500,
    `status=${terminalCommitment.status} body=${JSON.stringify(terminalCommitment.body ?? {}).slice(0, 200)}`,
  );

  // ─── 4. File commitment through the public BFF edge ───
  const filedCommitment = await post(
    BFF,
    '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID + '/commitments',
    {
      claimId: 'claim-mh-promise-1',
      successCriterion: 'M-RA acceptance commitment ' + Date.now(),
      dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    auth,
  );
  check(
    'POST /api/v1/mandate-holders/:id/commitments → 201',
    filedCommitment.status === 201,
    `status=${filedCommitment.status} body=${JSON.stringify(filedCommitment.body ?? {}).slice(0, 200)}`,
  );
  const filedCommitmentId = filedCommitment.status === 201 ? extractCommitmentId(filedCommitment) : '';
  check('filed commitment response has id', !!filedCommitmentId, `body=${JSON.stringify(filedCommitment.body ?? {}).slice(0, 200)}`);

  const filedCommitmentRead = filedCommitmentId
    ? await get(BFF, '/api/v1/commitments/' + filedCommitmentId)
    : { status: 0, body: null };
  check(
    'filed commitment is publicly readable',
    filedCommitmentRead.status === 200,
    `id=${filedCommitmentId} status=${filedCommitmentRead.status}`,
  );
  check(
    'filed commitment is non-terminal on publication',
    ['proposed', 'in_progress', 'overdue'].includes(filedCommitmentRead.body?.effectiveStatus),
    `effectiveStatus=${filedCommitmentRead.body?.effectiveStatus}`,
  );

  const restrictedEvidenceText = 'MRA_RESTRICTED_EVIDENCE_DO_NOT_LEAK_' + Date.now();
  const restrictedEvidenceCommitment = await post(
    BFF,
    '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID + '/commitments',
    {
      text: 'M-RA acceptance restricted evidence redaction probe ' + Date.now(),
      successCriterion: 'Public reads must redact restricted evidence fields.',
      evidence: [
        {
          visibility: 'restricted',
          locator: { uri: 'urn:polis:mra-acceptance:restricted' },
          quote: restrictedEvidenceText,
          paraphrase: restrictedEvidenceText + '_PARAPHRASE',
          sourceHash: 'sha256:' + restrictedEvidenceText,
        },
      ],
    },
    auth,
  );
  check(
    'restricted-evidence probe commitment filing succeeds',
    restrictedEvidenceCommitment.status === 201,
    `status=${restrictedEvidenceCommitment.status} body=${JSON.stringify(restrictedEvidenceCommitment.body ?? {}).slice(0, 200)}`,
  );
  const restrictedEvidenceCommitmentId =
    restrictedEvidenceCommitment.status === 201 ? extractCommitmentId(restrictedEvidenceCommitment) : '';
  const restrictedEvidenceRead = restrictedEvidenceCommitmentId
    ? await get(BFF, '/api/v1/commitments/' + restrictedEvidenceCommitmentId)
    : { status: 0, body: null };
  check(
    'restricted-evidence probe commitment is publicly readable',
    restrictedEvidenceRead.status === 200,
    `id=${restrictedEvidenceCommitmentId} status=${restrictedEvidenceRead.status}`,
  );
  const restrictedEvidencePublicJson = JSON.stringify(restrictedEvidenceRead.body ?? {});
  check(
    'public read does not leak raw restricted evidence text',
    !restrictedEvidencePublicJson.includes(restrictedEvidenceText),
    `body=${restrictedEvidencePublicJson.slice(0, 200)}`,
  );
  const restrictedEvidence = restrictedEvidenceFindings(restrictedEvidenceRead.body);
  check(
    'public read exposes restricted/private evidence redacted placeholders',
    restrictedEvidence.checked > 0 &&
      restrictedEvidence.redacted === restrictedEvidence.checked &&
      restrictedEvidence.leaks.length === 0,
    `checked=${restrictedEvidence.checked} redacted=${restrictedEvidence.redacted} leaks=${restrictedEvidence.leaks.join(',')}`,
  );

  // ─── 5. File resolution; no terminal status is effective until review approval ───
  const resolutionTargetId = filedCommitmentRead.status === 200 ? filedCommitmentId : RESOLUTION_COMMITMENT_ID;
  const beforeResolution = await get(BFF, '/api/v1/commitments/' + resolutionTargetId);
  const beforeResolutionStatus = beforeResolution.body?.effectiveStatus;
  const filedResolution = await post(
    BFF,
    '/api/v1/commitments/' + resolutionTargetId + '/resolutions',
    { status: 'delivered', resolutionClaimId: 'claim-mh-resolution-1' },
    auth,
  );
  check(
    'POST /api/v1/commitments/:id/resolutions → 201',
    filedResolution.status === 201,
    `status=${filedResolution.status} body=${JSON.stringify(filedResolution.body ?? {}).slice(0, 200)}`,
  );
  const resolutionSubmissionId = extractSubmissionId(filedResolution);
  check('filed resolution response has review submission id', !!resolutionSubmissionId, `body=${JSON.stringify(filedResolution.body ?? {}).slice(0, 200)}`);

  const afterResolutionBeforeReview = await get(BFF, '/api/v1/commitments/' + resolutionTargetId);
  check(
    'resolution filing alone does not set terminal status',
    afterResolutionBeforeReview.body?.effectiveStatus === beforeResolutionStatus,
    `before=${beforeResolutionStatus} after=${afterResolutionBeforeReview.body?.effectiveStatus}`,
  );

  // ─── 6. Review approval applies terminal status ───
  const approveResolution = resolutionSubmissionId
    ? await post(BFF, '/api/v1/review/' + resolutionSubmissionId + '/decide', {
        reviewerRole: 'reviewer',
        reviewerId: REVIEWER_ID,
        decision: 'approve',
      })
    : { status: 0, body: null };
  check(
    'POST /api/v1/review/:id/decide approve → 201',
    approveResolution.status === 201,
    `status=${approveResolution.status} body=${JSON.stringify(approveResolution.body ?? {}).slice(0, 200)}`,
  );
  check('approved resolution applied === true', approveResolution.body?.applied === true, `applied=${approveResolution.body?.applied}`);

  const afterResolutionApproval = await get(BFF, '/api/v1/commitments/' + resolutionTargetId);
  check('GET approved commitment detail → 200', afterResolutionApproval.status === 200, `status=${afterResolutionApproval.status}`);
  check(
    'effective status changed to delivered after review approval',
    afterResolutionApproval.body?.effectiveStatus === 'delivered',
    `effectiveStatus=${afterResolutionApproval.body?.effectiveStatus}`,
  );
  check(
    'latest status event is delivered with resolution claim',
    afterResolutionApproval.body?.statusTimeline?.[0]?.status === 'delivered' &&
      afterResolutionApproval.body?.statusTimeline?.[0]?.resolutionClaimId,
    `latest=${JSON.stringify(afterResolutionApproval.body?.statusTimeline?.[0] ?? null)}`,
  );

  // ─── 7. Scorecard counts reflect approved terminal status ───
  const afterScorecard = await get(BFF, '/api/v1/mandate-holders/' + MANDATE_HOLDER_ID + '/scorecard');
  check('GET scorecard after approval → 200', afterScorecard.status === 200, `status=${afterScorecard.status}`);
  check(
    'scorecard terminal count increased',
    totalTerminalCount(afterScorecard) > terminalBefore,
    `before=${terminalBefore} after=${totalTerminalCount(afterScorecard)} totals=${JSON.stringify(afterScorecard.body?.totals)}`,
  );
}

console.log(`[phase-mra] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

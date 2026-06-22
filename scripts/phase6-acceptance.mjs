// Phase 6 (M6) acceptance: exercises the §30.7 contribution + review v0 contract
// end-to-end against a running stack (contribution-service :8450, platform-api
// BFF :8080, seeded Postgres).
//
// Verifies:
//   1.  Submit evidence → 201 pending.
//   2.  Identity gate — anonymous rejected (403).
//   3.  Reviewer approves → status approved.
//   4.  Invalid decision rejected (400 invalid_decision).
//   5.  Already-decided guarded (409 already_decided).
//   6.  Accepted evidence is public in GET /api/v1/claims.
//   7.  Audit trail — contribution.submitted + contribution.approved.
//   8.  Reject path — rejected submission NOT applied publicly.
//   9.  Graph-edit path — approved proposal applied + graph.edit.applied audit.
//  10.  contribution-service /healthz ok.
//
// Run AFTER `docker compose up -d --build --wait`.
const CONTRIB = process.env.CONTRIBUTION_INTERNAL_URL ?? 'http://localhost:8450';
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
async function post(base, path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

console.log('[phase6] checking §30.7 contribution + review v0 contract…');

// 1. Submit evidence → 201 pending.
const evidenceText = 'M6 acceptance: registry office accepts digital residence proof.';
const submitted = await post(BFF, '/api/v1/contribute/evidence', {
  contributor: { displayName: 'Ada Test', identityLevel: 'verified' },
  payload: {
    text: evidenceText,
    claimType: 'document_requirement',
    subjectType: 'process_step',
    subjectId: 'step-registry-validation',
    confidence: 0.8,
  },
});
check(
  'POST /api/v1/contribute/evidence → 201',
  submitted.status === 201,
  `status=${submitted.status}`,
);
check(
  'submitted evidence status pending',
  submitted.body?.status === 'pending',
  `status=${submitted.body?.status}`,
);
const evidenceId = submitted.body?.id ?? '';
check('submitted evidence has id', typeof evidenceId === 'string' && evidenceId.length > 0);

// 2. Identity gate — anonymous rejected.
const anon = await post(BFF, '/api/v1/contribute/evidence', {
  contributor: { displayName: 'Ghost', identityLevel: 'anonymous' },
  payload: {
    text: 'should be rejected',
    claimType: 'other',
    subjectType: 'x',
    subjectId: 'y',
    confidence: 0.5,
  },
});
check('anonymous submit → 403 identity_required', anon.status === 403, `status=${anon.status}`);

// 3. Reviewer approves.
const approve = evidenceId
  ? await post(CONTRIB, '/internal/review/' + evidenceId + '/decide', {
      reviewerId: 'reviewer-demo',
      reviewerRole: 'reviewer',
      decision: 'approve',
    })
  : { status: 0, body: null };
check(
  'POST /internal/review/:id/decide approve → 201',
  approve.status === 201,
  `status=${approve.status}`,
);
check(
  'approved submission status approved',
  approve.body?.status === 'approved',
  `status=${approve.body?.status}`,
);

// 4. Invalid decision rejected.
const badDecision = evidenceId
  ? await post(CONTRIB, '/internal/review/' + evidenceId + '/decide', {
      reviewerId: 'reviewer-demo',
      reviewerRole: 'reviewer',
      decision: 'maybe',
    })
  : { status: 0, body: null };
check('invalid decision → 400', badDecision.status === 400, `status=${badDecision.status}`);

// 5. Already-decided guarded.
const alreadyDecided = evidenceId
  ? await post(CONTRIB, '/internal/review/' + evidenceId + '/decide', {
      reviewerId: 'reviewer-demo',
      reviewerRole: 'reviewer',
      decision: 'reject',
    })
  : { status: 0, body: null };
check('already-decided → 409', alreadyDecided.status === 409, `status=${alreadyDecided.status}`);

// 6. Accepted evidence is public.
const claims = await get(BFF, '/api/v1/claims');
check('GET /api/v1/claims → 200', claims.status === 200, `status=${claims.status}`);
const claimTexts = (claims.body?.items ?? []).map((c) => c.text);
check(
  'submitted evidence text present in public claims',
  claimTexts.includes(evidenceText),
  `texts=${JSON.stringify(claimTexts).slice(0, 160)}`,
);

// 7. Audit trail.
const audit = evidenceId
  ? await get(BFF, '/api/v1/audit/contribution/' + evidenceId)
  : { status: 0, body: null };
check('GET /api/v1/audit/contribution/:id → 200', audit.status === 200, `status=${audit.status}`);
const auditItems = audit.body?.items ?? [];
check(
  'audit contains contribution.submitted',
  Array.isArray(auditItems) && auditItems.some((e) => e?.eventType === 'contribution.submitted'),
  `items=${JSON.stringify(auditItems).slice(0, 200)}`,
);
check(
  'audit contains contribution.approved',
  Array.isArray(auditItems) && auditItems.some((e) => e?.eventType === 'contribution.approved'),
  `items=${JSON.stringify(auditItems).slice(0, 200)}`,
);

// 8. Reject path.
const rejectedText = 'M6 acceptance: this evidence should be rejected and never published.';
const rejectedSub = await post(BFF, '/api/v1/contribute/evidence', {
  contributor: { displayName: 'Ben Test', identityLevel: 'casual' },
  payload: {
    text: rejectedText,
    claimType: 'other',
    subjectType: 'process_step',
    subjectId: 'step-rejection',
    confidence: 0.3,
  },
});
const rejectedId = rejectedSub.body?.id ?? '';
const rejectDecision = rejectedId
  ? await post(CONTRIB, '/internal/review/' + rejectedId + '/decide', {
      reviewerId: 'reviewer-demo',
      reviewerRole: 'reviewer',
      decision: 'reject',
    })
  : { status: 0, body: null };
check('reject decision → 201', rejectDecision.status === 201, `status=${rejectDecision.status}`);
check(
  'rejected submission status rejected',
  rejectDecision.body?.status === 'rejected',
  `status=${rejectDecision.body?.status}`,
);
const claimsAfterReject = await get(BFF, '/api/v1/claims');
const claimTextsAfter = (claimsAfterReject.body?.items ?? []).map((c) => c.text);
check(
  'rejected evidence text NOT in public claims',
  !claimTextsAfter.includes(rejectedText),
  `present=${claimTextsAfter.includes(rejectedText)}`,
);

// 9. Graph-edit path.
const graphEdit = await post(BFF, '/api/v1/contribute/graph-edit', {
  contributor: { displayName: 'Cara Test', identityLevel: 'verified' },
  payload: {
    targetTable: 'sources',
    op: 'insert',
    proposedPayload: {
      title: 'M6 seed source',
      url: 'https://example.org/m6',
      sourceType: 'official',
    },
  },
});
check(
  'POST /api/v1/contribute/graph-edit → 201',
  graphEdit.status === 201,
  `status=${graphEdit.status}`,
);
const graphEditId = graphEdit.body?.id ?? '';
const proposalId = graphEdit.body?.proposal?.id ?? '';
check('graph-edit returns proposal id', typeof proposalId === 'string' && proposalId.length > 0);
const graphApprove = graphEditId
  ? await post(CONTRIB, '/internal/review/' + graphEditId + '/decide', {
      reviewerId: 'reviewer-demo',
      reviewerRole: 'reviewer',
      decision: 'approve',
    })
  : { status: 0, body: null };
check('graph-edit approve → 201', graphApprove.status === 201, `status=${graphApprove.status}`);
check(
  'graph-edit applied true',
  graphApprove.body?.applied === true,
  `applied=${graphApprove.body?.applied}`,
);
const graphDetail = graphEditId
  ? await get(BFF, '/api/v1/contributions/' + graphEditId)
  : { status: 0, body: null };
check(
  'graph-edit proposal appliedAt set',
  graphDetail.body?.proposal?.appliedAt != null,
  `appliedAt=${graphDetail.body?.proposal?.appliedAt}`,
);
const graphProposalId = graphDetail.body?.proposal?.id ?? proposalId;
const graphAudit = graphProposalId
  ? await get(BFF, '/api/v1/audit/graph-proposal/' + graphProposalId)
  : { status: 0, body: null };
const graphAuditItems = graphAudit.body?.items ?? [];
check(
  'audit contains graph.edit.applied',
  Array.isArray(graphAuditItems) &&
    graphAuditItems.some((e) => e?.eventType === 'graph.edit.applied'),
  `items=${JSON.stringify(graphAuditItems).slice(0, 200)}`,
);

// 10. Health.
const health = await get(CONTRIB, '/healthz');
check('contribution-service /healthz ok', health.body?.status === 'ok', `status=${health.status}`);

console.log(`[phase6] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

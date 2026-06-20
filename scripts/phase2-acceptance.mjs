// Phase 2 (M2) acceptance: exercises the §13 + §30.3 Polis deliberation contract
// end-to-end against a running stack (polis-bridge-service :8200, audit-service
// :8600, platform-api BFF :8080, seeded Postgres). Creates a conversation via the
// internal route, syncs a stub result, and asserts the BFF returns it hydrated on
// the issue, the embed config is present, and both audit events land in the public
// audit read. Discovers ids from the API so it is seed-agnostic.
// Run AFTER `docker compose up -d --wait` + `pnpm db:seed` (or dev-services).
const POLIS = process.env.POLIS_INTERNAL_URL ?? 'http://localhost:8200';
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

console.log('[phase2] checking §13 Polis deliberation contract…');

// 1. BFF lists the seeded issues.
const issues = await get(BFF, '/api/v1/issues');
check(
  'bff /api/v1/issues count >= 2',
  Array.isArray(issues.body?.items) && issues.body.items.length >= 2,
  `got ${issues.body?.items?.length}`,
);

// 2. First issue detail carries id/slug and a hydrated conversation (seeded).
const firstIssue = issues.body?.items?.[0];
check('resolved a first issue id', !!firstIssue?.id);
const issueDetail = firstIssue ? await get(BFF, `/api/v1/issues/${firstIssue.id}`) : { body: null };
check(
  'issue detail has id + slug',
  !!issueDetail.body?.id && !!issueDetail.body?.slug,
  `keys=${issueDetail.body ? Object.keys(issueDetail.body).join(',') : 'null'}`,
);
check('first issue has a hydrated conversation', !!issueDetail.body?.conversation);

// 3. Internal create produces a conversation row with an external Polis id.
const created = firstIssue
  ? await post(POLIS, '/internal/polis/conversations', {
      actor: { type: 'service', id: 'acceptance' },
      issueId: firstIssue.id,
      title: 'Acceptance test conversation',
      framingQuestion: 'Which duplicate handoff should be eliminated first?',
      participationMode: 'open',
    })
  : { status: 0, body: null };
check(
  'POST /internal/polis/conversations → 201',
  created.status === 201,
  `status=${created.status}`,
);
check(
  'created conversation has externalPolisId + id',
  !!created.body?.externalPolisId && !!created.body?.id,
  `keys=${created.body ? Object.keys(created.body).join(',') : 'null'}`,
);
const conversationId = created.body?.id ?? '';

// 4. Internal sync appends a result snapshot.
const synced = conversationId
  ? await post(POLIS, `/internal/polis/conversations/${conversationId}/sync`, {})
  : { status: 0, body: null };
check(
  'POST /internal/polis/conversations/:id/sync → 201',
  synced.status === 201,
  `status=${synced.status}`,
);
check(
  'synced result has participantCount + consensusGroups',
  synced.body != null && 'participantCount' in synced.body && 'consensusGroups' in synced.body,
  `keys=${synced.body ? Object.keys(synced.body).join(',') : 'null'}`,
);

// 5. The BFF now hydrates the (latest) conversation + a result on the issue.
const issueAfter = firstIssue ? await get(BFF, `/api/v1/issues/${firstIssue.id}`) : { body: null };
check('issue still has a conversation after create/sync', !!issueAfter.body?.conversation);
check('issue has a conversationResult attached', !!issueAfter.body?.conversationResult);

// 6. Embed config carries a mode (stub in M2; iframe when a reportUrl exists).
const embed = firstIssue
  ? await get(BFF, `/api/v1/issues/${firstIssue.id}/conversation`)
  : { body: null };
check('embed config has a mode', !!embed.body?.embed && typeof embed.body.embed.mode === 'string');

// 7. Both deliberation audit events land in the public audit read (per-conversation).
const audit = conversationId
  ? await get(BFF, `/api/v1/audit/conversation/${conversationId}`)
  : { body: null };
const eventTypes = Array.isArray(audit.body?.items) ? audit.body.items.map((e) => e.eventType) : [];
check(
  'audit read returns polis.conversation.created',
  eventTypes.includes('polis.conversation.created'),
  `events=${eventTypes.join(',')}`,
);
check(
  'audit read returns polis.result.synced',
  eventTypes.includes('polis.result.synced'),
  `events=${eventTypes.join(',')}`,
);

// 8. Process-scoped issues route returns an items array (seeded first issue if its process_id matched).
const procs = await get(BFF, '/api/v1/processes');
const procId = procs.body?.items?.[0]?.id;
check('resolved a process id', !!procId);
if (procId) {
  const procIssues = await get(BFF, `/api/v1/processes/${procId}/issues`);
  check(
    '/api/v1/processes/:id/issues returns items[]',
    Array.isArray(procIssues.body?.items),
    `status=${procIssues.status} keys=${procIssues.body ? Object.keys(procIssues.body).join(',') : 'null'}`,
  );
}

console.log(`[phase2] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

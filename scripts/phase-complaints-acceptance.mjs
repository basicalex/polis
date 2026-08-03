import assert from 'node:assert/strict';
import { loginCitizen } from './dev-login.mjs';

// Development-only acceptance against `bun scripts/dev-services.mjs` and a fresh seed.
// Normal lifecycle calls traverse platform-api; the one direct call proves the
// complaints service refuses internal traffic without its service token.
const PROFILE = process.env.DEPLOYMENT_PROFILE ?? 'dev';
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const COMPLAINTS = process.env.COMPLAINTS_URL ?? 'http://localhost:8970';
const INITIAL_HOLDER_ID = 'mh-complaint-decision-officer-demo';

if (PROFILE !== 'dev') {
  throw new Error('phase-complaints-acceptance is development-only (DEPLOYMENT_PROFILE=dev)');
}

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? `: ${detail}` : ''}`);
  } else console.log(`  ok  ${label}`);
}

async function request(base, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const bffRequest = (path, options) => request(BFF, path, options);
const sessionHeaders = (session) => ({ authorization: `Bearer ${session.sessionToken}` });

function assertPrivateFieldsAbsent(value) {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes('residentCitizenId'), 'response leaked residentCitizenId');
  assert.ok(!serialized.includes('auditCorrelationId'), 'response leaked auditCorrelationId');
}

async function login(email, expectedIdentityLevel) {
  const result = await loginCitizen(BFF, email);
  check(`${email} login succeeds`, !result.error, result.error ?? '');
  check(
    `${email} has ${expectedIdentityLevel} identity`,
    result.citizen?.identityLevel === expectedIdentityLevel,
    `identityLevel=${result.citizen?.identityLevel ?? result.error}`,
  );
  check(`${email} returns a citizen id`, typeof result.citizen?.id === 'string');
  return result;
}

console.log('[phase-complaints] checking development-only BFF complaints lifecycle');

const unauthenticated = await bffRequest('/api/v1/complaints', {
  method: 'POST',
  body: { subject: 'Unauthenticated complaint', narrative: 'This request has no session.' },
});
check(
  'unauthenticated complaint create through BFF → 401',
  unauthenticated.status === 401,
  `status=${unauthenticated.status}`,
);
check(
  'unauthenticated complaint error is explicit',
  unauthenticated.body?.error === 'unauthenticated',
);

const noServiceToken = await request(COMPLAINTS, '/internal/complaints/mine', {
  headers: {
    'x-polis-citizen': 'citizen-without-service-token',
    'x-polis-identity-level': 'verified_resident',
  },
});
check(
  'direct internal call without service token → 401',
  noServiceToken.status === 401,
  `status=${noServiceToken.status}`,
);
check(
  'missing service token error is explicit',
  noServiceToken.body?.error === 'internal_auth_required',
);

const suffix = Date.now();
const resident = await login(`complaint-resident-${suffix}@test.local`, 'verified_resident');
const otherResident = await login(
  `complaint-other-resident-${suffix}@test.local`,
  'verified_resident',
);
const reviewer = await login('reviewer-demo@polis.local', 'staff');
const intake = await login('complaint-intake-officer@polis.local', 'staff');
const initialOfficer = await login('initial-complaint-officer@polis.local', 'staff');
const appealOfficer = await login('appeal-complaint-officer@polis.local', 'staff');

const created = await bffRequest('/api/v1/complaints', {
  method: 'POST',
  headers: sessionHeaders(resident),
  body: {
    subject: `Missed municipal collection ${suffix}`,
    narrative: 'The scheduled collection did not occur and the service channel did not resolve it.',
  },
});
check(
  'resident creates complaint through BFF → 201',
  created.status === 201,
  `status=${created.status}`,
);
check('created complaint starts submitted', created.body?.status === 'submitted');
assertPrivateFieldsAbsent(created.body);
const complaintId = created.body?.id;
check('created complaint has an id', typeof complaintId === 'string');

const mine = await bffRequest('/api/v1/complaints/mine', { headers: sessionHeaders(resident) });
check('resident reads own complaints → 200', mine.status === 200, `status=${mine.status}`);
check(
  'resident mine contains created complaint',
  mine.body?.items?.some((item) => item.id === complaintId),
);
assertPrivateFieldsAbsent(mine.body);

const detail = await bffRequest(`/api/v1/complaints/${complaintId}`, {
  headers: sessionHeaders(resident),
});
check('resident reads complaint detail → 200', detail.status === 200, `status=${detail.status}`);
check('resident complaint detail is submitted', detail.body?.status === 'submitted');
assertPrivateFieldsAbsent(detail.body);

const otherDetail = await bffRequest(`/api/v1/complaints/${complaintId}`, {
  headers: sessionHeaders(otherResident),
});
check(
  'second resident cannot read owner complaint → 403',
  otherDetail.status === 403,
  `status=${otherDetail.status}`,
);
check('owner denial is explicit', otherDetail.body?.error === 'complaint_access_denied');

const reviewerQueue = await bffRequest('/api/v1/complaints/queue', {
  headers: sessionHeaders(reviewer),
});
check(
  'ordinary reviewer cannot read complaint queue → 403',
  reviewerQueue.status === 403,
  `status=${reviewerQueue.status}`,
);
check('staff denial is explicit', reviewerQueue.body?.error === 'complaint_staff_access_denied');

const queue = await bffRequest('/api/v1/complaints/queue', { headers: sessionHeaders(intake) });
check('intake officer reads complaint queue → 200', queue.status === 200, `status=${queue.status}`);
check(
  'intake queue contains created complaint',
  queue.body?.items?.some((item) => item.id === complaintId),
);
assertPrivateFieldsAbsent(queue.body);

const assignment = await bffRequest(`/api/v1/complaints/${complaintId}/assign`, {
  method: 'POST',
  headers: sessionHeaders(intake),
  body: { assignedMandateHolderId: INITIAL_HOLDER_ID },
});
check(
  'intake officer assigns complaint → 200',
  assignment.status === 200,
  `status=${assignment.status}`,
);
check('assignment moves complaint to assigned', assignment.body?.status === 'assigned');
assertPrivateFieldsAbsent(assignment.body);

const informationRequest = await bffRequest(
  `/api/v1/complaints/${complaintId}/information-requests`,
  {
    method: 'POST',
    headers: sessionHeaders(intake),
    body: {
      question: 'Please provide the missed collection date and the prior service reference.',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  },
);
check(
  'intake officer requests information → 201',
  informationRequest.status === 201,
  `status=${informationRequest.status}`,
);
check('information request has an id', typeof informationRequest.body?.id === 'string');
assertPrivateFieldsAbsent(informationRequest.body);
const informationRequestId = informationRequest.body?.id;

const otherResidentResponse = await bffRequest(
  `/api/v1/complaints/${complaintId}/information-requests/${informationRequestId}/respond`,
  {
    method: 'POST',
    headers: sessionHeaders(otherResident),
    body: { response: 'This resident does not own the complaint.' },
  },
);
check(
  'second resident cannot respond to owner information request → 403',
  otherResidentResponse.status === 403,
  `status=${otherResidentResponse.status}`,
);
check(
  'information response ownership denial is explicit',
  otherResidentResponse.body?.error === 'complaint_owner_required',
);

const informationResponse = await bffRequest(
  `/api/v1/complaints/${complaintId}/information-requests/${informationRequestId}/respond`,
  {
    method: 'POST',
    headers: sessionHeaders(resident),
    body: { response: 'The collection was missed on 2026-08-03; service reference is SR-12345.' },
  },
);
check(
  'owner responds to information request → 200',
  informationResponse.status === 200,
  `status=${informationResponse.status}`,
);
check(
  'information response belongs to resident',
  informationResponse.body?.respondedBy === resident.citizen?.id,
);
assertPrivateFieldsAbsent(informationResponse.body);

const initialDecision = await bffRequest(`/api/v1/complaints/${complaintId}/decisions`, {
  method: 'POST',
  headers: sessionHeaders(initialOfficer),
  body: {
    outcome: 'upheld',
    reason: 'The missed collection is confirmed by the supplied service reference.',
  },
});
check(
  'assigned initial officer decides complaint → 201',
  initialDecision.status === 201,
  `status=${initialDecision.status}`,
);
check('initial decision is marked initial', initialDecision.body?.kind === 'initial');
assertPrivateFieldsAbsent(initialDecision.body);

const residentAppeal = await bffRequest(`/api/v1/complaints/${complaintId}/appeals`, {
  method: 'POST',
  headers: sessionHeaders(resident),
  body: { grounds: 'The corrective action and remedy are insufficient.' },
});
check(
  'resident files appeal → 201',
  residentAppeal.status === 201,
  `status=${residentAppeal.status}`,
);
check('appeal has an id', typeof residentAppeal.body?.id === 'string');
assertPrivateFieldsAbsent(residentAppeal.body);
const appealId = residentAppeal.body?.id;

const sameDeciderAppeal = await bffRequest(
  `/api/v1/complaints/${complaintId}/appeals/${appealId}/decisions`,
  {
    method: 'POST',
    headers: sessionHeaders(initialOfficer),
    body: { outcome: 'upheld', reason: 'The original decision is unchanged.' },
  },
);
check(
  'initial decider cannot decide the appeal → 403',
  sameDeciderAppeal.status === 403,
  `status=${sameDeciderAppeal.status}`,
);

const appealDecision = await bffRequest(
  `/api/v1/complaints/${complaintId}/appeals/${appealId}/decisions`,
  {
    method: 'POST',
    headers: sessionHeaders(appealOfficer),
    body: { outcome: 'modified', reason: 'An independent review grants a fuller remedy.' },
  },
);
check(
  'appeal officer decides appeal → 201',
  appealDecision.status === 201,
  `status=${appealDecision.status}`,
);
check('appeal decision is marked appeal', appealDecision.body?.kind === 'appeal');
assertPrivateFieldsAbsent(appealDecision.body);

const closedDetail = await bffRequest(`/api/v1/complaints/${complaintId}`, {
  headers: sessionHeaders(resident),
});
check('appeal decision closes complaint', closedDetail.body?.status === 'closed');
check('appeal is recorded as decided', closedDetail.body?.appeal?.status === 'decided');
assertPrivateFieldsAbsent(closedDetail.body);

const directCase = await bffRequest('/api/v1/complaints', {
  method: 'POST',
  headers: sessionHeaders(resident),
  body: {
    subject: `Direct close complaint ${suffix}`,
    narrative: 'This second case exercises closure without an appeal.',
  },
});
check(
  'resident creates direct-close case → 201',
  directCase.status === 201,
  `status=${directCase.status}`,
);
assertPrivateFieldsAbsent(directCase.body);
const directCaseId = directCase.body?.id;

const directAssignment = await bffRequest(`/api/v1/complaints/${directCaseId}/assign`, {
  method: 'POST',
  headers: sessionHeaders(intake),
  body: { assignedMandateHolderId: INITIAL_HOLDER_ID },
});
check(
  'intake officer assigns direct-close case → 200',
  directAssignment.status === 200,
  `status=${directAssignment.status}`,
);
assertPrivateFieldsAbsent(directAssignment.body);

const directDecision = await bffRequest(`/api/v1/complaints/${directCaseId}/decisions`, {
  method: 'POST',
  headers: sessionHeaders(initialOfficer),
  body: { outcome: 'upheld', reason: 'The second case is decided without further information.' },
});
check(
  'initial officer decides direct-close case → 201',
  directDecision.status === 201,
  `status=${directDecision.status}`,
);
assertPrivateFieldsAbsent(directDecision.body);

const directClose = await bffRequest(`/api/v1/complaints/${directCaseId}/close`, {
  method: 'POST',
  headers: sessionHeaders(initialOfficer),
});
check(
  'initial officer directly closes unappealed case → 200',
  directClose.status === 200,
  `status=${directClose.status}`,
);
check('direct close marks case closed', directClose.body?.status === 'closed');
assertPrivateFieldsAbsent(directClose.body);

if (failures) {
  console.error(`[phase-complaints] ${failures} acceptance check(s) failed`);
  process.exitCode = 1;
} else console.log('[phase-complaints] all development-only acceptance checks passed');

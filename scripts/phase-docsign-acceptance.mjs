import assert from 'node:assert/strict';
import { withInternalHeaders } from './internal-headers.mjs';

// Charter-signing acceptance against a freshly seeded live local stack.
// Start the stack with IDENTITY_DEV_TOKENS=true and the default stub signing
// provider, then run: node scripts/phase-docsign-acceptance.mjs

const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const SIGNING = process.env.SIGNING_INTERNAL_URL ?? 'http://localhost:8960';
const HOLDER_ID = 'mh-demo';
const OFFICIAL_EMAIL = 'mandate-holder-demo@polis.local';
const STAFF_EMAIL = 'reviewer-demo@polis.local';
const IN_SCOPE_JURISDICTION = 'jur-croatia-local';

function step(number, label) {
  console.log(`\n[${number}/11] ${label}`);
}

function check(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? `: ${detail}` : ''}`);
  console.log(`  ok  ${label}`);
}

async function request(base, path, { method = 'GET', body, headers = {}, internal = false } = {}) {
  const requestHeaders = body === undefined ? { ...headers } : { 'content-type': 'application/json', ...headers };
  const response = await fetch(base + path, {
    method,
    headers: internal ? withInternalHeaders(path, requestHeaders) : requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

const getPublic = (path, headers = {}) => request(BFF, path, { headers });
const postPublic = (path, body, headers = {}) =>
  request(BFF, path, { method: 'POST', body, headers });
const getInternal = (path, headers = {}) => request(SIGNING, path, { headers, internal: true });
const postInternal = (path, body = {}) =>
  request(SIGNING, path, { method: 'POST', body, internal: true });

async function citizenLogin(email) {
  const magicLink = await postPublic('/api/v1/identity/magic-link', { email });
  assert.equal(magicLink.status, 200, `magic-link failed for ${email}: ${magicLink.status}`);
  const devTokens = await getPublic('/api/v1/identity/dev-tokens');
  assert.equal(devTokens.status, 200, `dev-token lookup failed: ${devTokens.status}`);
  const token = devTokens.body?.tokens?.[email];
  assert.equal(typeof token, 'string', `dev token missing for ${email}`);
  const exchange = await postPublic('/api/v1/identity/exchange', { email, token });
  assert.equal(exchange.status, 200, `session exchange failed for ${email}: ${exchange.status}`);
  assert.equal(typeof exchange.body?.sessionToken, 'string', `session token missing for ${email}`);
  return {
    auth: { authorization: `Bearer ${exchange.body.sessionToken}` },
    citizen: exchange.body.citizen,
  };
}

function assertNoRestrictedCharterData(value) {
  const forbiddenKeys = new Set([
    'recipient',
    'recipients',
    'recipientemail',
    'providerenvelopeid',
    'envelopeid',
    'storageref',
    'contentbase64',
    'documentbytes',
    'bytes',
  ]);
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, nested] of Object.entries(candidate)) {
      assert.ok(!forbiddenKeys.has(key.toLowerCase()), `public projection leaked restricted key ${key}`);
      visit(nested);
    }
  };
  visit(value);
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes(OFFICIAL_EMAIL), 'public projection leaked signer email');
}

console.log('[phase-docsign] checking charter signing end-to-end flow');

step(1, 'seeded charter starts pending and unsigned');
const initialProjection = await getPublic(`/api/v1/mandate-holders/${HOLDER_ID}`);
check('public mandate-holder projection returns 200', initialProjection.status === 200, `status=${initialProjection.status}`);
check('charterStatus is pending', initialProjection.body?.charterStatus === 'pending', `status=${initialProjection.body?.charterStatus}`);
check('charterAccepted is false', initialProjection.body?.charterAccepted === false);
check('charterSignedAt is null', initialProjection.body?.charterSignedAt === null);
check('charterProofId is null', initialProjection.body?.charterProofId === null);
check('charterSignedDocumentHash is null', initialProjection.body?.charterSignedDocumentHash === null);

step(2, 'official is denied publication before signing');
const official = await citizenLogin(OFFICIAL_EMAIL);
check('official identity is verified_official', official.citizen?.identityLevel === 'verified_official');
const unsignedPublish = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/commitments`,
  {
    text: 'Charter acceptance must precede this commitment.',
    successCriterion: 'The unsigned publish gate rejects this request.',
    jurisdictionId: IN_SCOPE_JURISDICTION,
  },
  official.auth,
);
check('unsigned publication returns 403', unsignedPublish.status === 403, `status=${unsignedPublish.status}`);
// A pending charter is rejected as charter_required; an accepted-but-unsigned
// charter is rejected as charter_signature_required. Both mean "not signature-backed".
check(
  'unsigned publication is denied for a missing or unsigned charter',
  unsignedPublish.body?.error === 'charter_required' ||
    unsignedPublish.body?.error === 'charter_signature_required',
  `error=${unsignedPublish.body?.error}`,
);

step(3, 'signing initiation requires Idempotency-Key');
const withoutKey = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/charter-signing-requests`,
  {},
  official.auth,
);
check('missing Idempotency-Key returns 400', withoutKey.status === 400, `status=${withoutKey.status}`);
check('missing key error is idempotency_key_required', withoutKey.body?.error === 'idempotency_key_required');
const idempotencyKey = `phase-docsign-${Date.now()}`;
const initiated = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/charter-signing-requests`,
  {},
  { ...official.auth, 'Idempotency-Key': idempotencyKey },
);
check('signing initiation returns 201', initiated.status === 201, `status=${initiated.status}`);
check('signing request has an id', typeof initiated.body?.id === 'string' && initiated.body.id.length > 0);
const signingRequestId = initiated.body.id;

step(4, 'repeated initiation is idempotent');
const repeatedInitiation = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/charter-signing-requests`,
  {},
  { ...official.auth, 'Idempotency-Key': idempotencyKey },
);
check('repeated initiation returns 201', repeatedInitiation.status === 201, `status=${repeatedInitiation.status}`);
check('repeated initiation returns the same request id', repeatedInitiation.body?.id === signingRequestId);
check('repeated initiation returns the same unsigned artifact id', repeatedInitiation.body?.unsignedArtifactId === initiated.body?.unsignedArtifactId);

step(5, 'a different citizen cannot initiate or complete signing');
const otherEmail = `docsign-other-${Date.now()}@test.local`;
const other = await citizenLogin(otherEmail);
const otherInitiation = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/charter-signing-requests`,
  {},
  { ...other.auth, 'Idempotency-Key': `${idempotencyKey}-other` },
);
check('different citizen initiation returns 403', otherInitiation.status === 403, `status=${otherInitiation.status}`);
check('different citizen is rejected as non-owner', otherInitiation.body?.error === 'mandate_holder_owner_required', `error=${otherInitiation.body?.error}`);
const otherCompletion = await postPublic(
  `/api/v1/signing-requests/${signingRequestId}/stub-complete`,
  {},
  other.auth,
);
check('different citizen stub-complete returns 403', otherCompletion.status === 403, `status=${otherCompletion.status}`);
check('different citizen is not a signing recipient', otherCompletion.body?.error === 'signing_recipient_required', `error=${otherCompletion.body?.error}`);

step(6, 'official completes the stub signing request');
const completed = await postPublic(
  `/api/v1/signing-requests/${signingRequestId}/stub-complete`,
  {},
  official.auth,
);
check('official stub-complete returns 200', completed.status === 200, `status=${completed.status}`);
check('signing request status is completed', completed.body?.status === 'completed', `status=${completed.body?.status}`);

step(7, 'completion creates one stable signed artifact, proof, and accepted charter');
check('completed request has signedArtifactId', typeof completed.body?.signedArtifactId === 'string' && completed.body.signedArtifactId.length > 0);
check('completed request has proofManifestId', typeof completed.body?.proofManifestId === 'string' && completed.body.proofManifestId.length > 0);
const signedArtifactId = completed.body.signedArtifactId;
const proofManifestId = completed.body.proofManifestId;
const repeatedCompletion = await postPublic(
  `/api/v1/signing-requests/${signingRequestId}/stub-complete`,
  {},
  official.auth,
);
check('repeated stub-complete remains 200', repeatedCompletion.status === 200, `status=${repeatedCompletion.status}`);
check('repeated stub-complete preserves signedArtifactId', repeatedCompletion.body?.signedArtifactId === signedArtifactId);
check('repeated stub-complete preserves proofManifestId', repeatedCompletion.body?.proofManifestId === proofManifestId);
const reconciled = await postInternal(`/internal/signing/requests/${signingRequestId}/reconcile`);
check('internal reconcile returns 200', reconciled.status === 200, `status=${reconciled.status}`);
check('reconcile preserves completed status', reconciled.body?.status === 'completed');
check('reconcile preserves signedArtifactId', reconciled.body?.signedArtifactId === signedArtifactId);
check('reconcile preserves proofManifestId', reconciled.body?.proofManifestId === proofManifestId);
const storedRequest = await getInternal(`/internal/signing/requests/${signingRequestId}`, {
  'x-polis-citizen': official.citizen.id,
  'x-polis-identity-level': official.citizen.identityLevel,
});
check('stored signing request returns 200', storedRequest.status === 200, `status=${storedRequest.status}`);
check('stored request preserves the single artifact id', storedRequest.body?.signedArtifactId === signedArtifactId);
check('stored request preserves the single proof id', storedRequest.body?.proofManifestId === proofManifestId);

step(8, 'public proof is active and signed hash verifies');
const proof = await getPublic(`/api/v1/proofs/${proofManifestId}`);
check('public proof is retrievable', proof.status === 200, `status=${proof.status}`);
check('public proof id matches the signing request', proof.body?.id === proofManifestId);
const proofStatus = await getPublic(`/api/v1/proofs/${proofManifestId}/status`);
check('public proof status returns 200', proofStatus.status === 200, `status=${proofStatus.status}`);
check('public proof registryStatus is active', proofStatus.body?.registryStatus === 'active', `registryStatus=${proofStatus.body?.registryStatus}`);
const acceptedProjection = await getPublic(`/api/v1/mandate-holders/${HOLDER_ID}`);
const signedDocumentHash = acceptedProjection.body?.charterSignedDocumentHash;
check('public projection has signed document hash', typeof signedDocumentHash === 'string' && signedDocumentHash.length > 0);
const verifiedHash = await postPublic('/api/v1/verify/hash', { hash: signedDocumentHash });
check('signed document hash verification returns 200', verifiedHash.status === 200, `status=${verifiedHash.status}`);
check('signed document hash verifies as valid', verifiedHash.body?.status === 'valid', `status=${verifiedHash.body?.status}`);
check('hash verification resolves the same proof', verifiedHash.body?.manifest?.id === proofManifestId);

step(9, 'accepted public charter projection is complete and safe');
check('charterStatus is accepted', acceptedProjection.body?.charterStatus === 'accepted', `status=${acceptedProjection.body?.charterStatus}`);
check('charterAccepted is true', acceptedProjection.body?.charterAccepted === true);
check('charterSignedAt is present', typeof acceptedProjection.body?.charterSignedAt === 'string' && acceptedProjection.body.charterSignedAt.length > 0);
check('charterProofId matches the completed request', acceptedProjection.body?.charterProofId === proofManifestId);
check('charterSignedDocumentHash remains present', acceptedProjection.body?.charterSignedDocumentHash === signedDocumentHash);
assertNoRestrictedCharterData(acceptedProjection.body);
console.log('  ok  public projection contains no recipient, envelope, storage, or document-byte fields');

step(10, 'official can publish in scope but not out of scope');
const inScope = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/commitments`,
  {
    text: `In-scope charter acceptance commitment ${Date.now()}.`,
    successCriterion: 'The in-scope commitment is accepted.',
    jurisdictionId: IN_SCOPE_JURISDICTION,
  },
  official.auth,
);
check('in-scope commitment returns 201', inScope.status === 201, `status=${inScope.status}`);
const outOfScope = await postPublic(
  `/api/v1/mandate-holders/${HOLDER_ID}/commitments`,
  {
    text: `Out-of-scope charter acceptance commitment ${Date.now()}.`,
    successCriterion: 'The out-of-scope commitment is rejected.',
    jurisdictionId: 'jur-outside-charter-scope',
  },
  official.auth,
);
check('out-of-scope commitment returns 403', outOfScope.status === 403, `status=${outOfScope.status}`);
check('out-of-scope denial uses charter_scope_not_covered', outOfScope.body?.error === 'charter_scope_not_covered', `error=${outOfScope.body?.error}`);

step(11, 'review decisions require staff and derive reviewer identity from the session');
const submission = await postPublic('/api/v1/contribute/evidence', {
  contributor: { displayName: 'Docsign Acceptance', identityLevel: 'verified' },
  payload: {
    text: `Docsign review submission ${Date.now()}`,
    claimType: 'other',
    subjectType: 'mandate_holder',
    subjectId: HOLDER_ID,
    confidence: 0.8,
    contributionClass: 'civic',
  },
});
check('review fixture submission returns 201', submission.status === 201, `status=${submission.status}`);
check('review fixture has an id', typeof submission.body?.id === 'string');
const submissionId = submission.body.id;
const nonStaffDecision = await postPublic(
  `/api/v1/review/${submissionId}/decide`,
  { decision: 'reject', notes: 'non-staff must not decide' },
  other.auth,
);
check('non-staff review decision returns 403', nonStaffDecision.status === 403, `status=${nonStaffDecision.status}`);
check('non-staff denial uses staff_required', nonStaffDecision.body?.error === 'staff_required', `error=${nonStaffDecision.body?.error}`);
const staff = await citizenLogin(STAFF_EMAIL);
check('staff identity level is staff', staff.citizen?.identityLevel === 'staff');
const staffDecision = await postPublic(
  `/api/v1/review/${submissionId}/decide`,
  { decision: 'reject', notes: 'reviewed by authenticated staff' },
  staff.auth,
);
check('staff decision without body reviewer identity returns 201', staffDecision.status === 201, `status=${staffDecision.status}`);
check('stored reviewer id comes from staff session', staffDecision.body?.review?.reviewerId === staff.citizen?.id, `reviewerId=${staffDecision.body?.review?.reviewerId}`);

console.log('\n[phase-docsign] ALL 11 CHECK GROUPS PASSED');

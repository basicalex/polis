import { withInternalHeaders } from './internal-headers.mjs';

// Phase 8 (M8) acceptance: exercises the §30.9 citizen vault v1 contract
// end-to-end against a running stack (citizen-identity-service :8650,
// citizen-vault-service :8750, vc-issuer-service :8950, platform-api BFF
// :8080, proof-service :8700, seeded Postgres).
//
// Verifies the three §30.9 acceptance criteria + deliverables:
//   1.  Login (identity) — magic-link → dev-token → exchange → session.
//   2.  Document listing — owner adds a vault document, lists it.
//   3.  Grant + verify in scope (criterion: grantee verifies within scope).
//   4.  Proof-only leak guard — verify never yields document bytes (structural).
//   5.  Access events visible (criterion: access events visible to user).
//   6.  Revoke (criterion: user can grant/revoke access).
//   7.  VC issuance (deliverable: proof-only sharing).
//   8.  Auth gate — unauthenticated requests → 401; internal routes not proxied.
//   9.  Health — all 3 new services healthy.
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const IDENTITY = process.env.IDENTITY_INTERNAL_URL ?? 'http://localhost:8650';
const VAULT = process.env.VAULT_INTERNAL_URL ?? 'http://localhost:8750';
const VC_ISSUER = process.env.VC_ISSUER_INTERNAL_URL ?? 'http://localhost:8950';
const PROOF = process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700';

let failures = 0;
function check(label, cond, detail = '') {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label} ${detail}`);
  } else {
    console.log(`  ok  ${label}`);
  }
}
async function get(base, path, headers = {}) {
  const r = await fetch(base + path, { headers: withInternalHeaders(path, headers) });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function post(base, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: withInternalHeaders(path, { 'content-type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function del(base, path, headers = {}) {
  const r = await fetch(base + path, {
    method: 'DELETE',
    headers: withInternalHeaders(path, { 'content-type': 'application/json', ...headers }),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

console.log('[phase8] checking §30.9 citizen vault v1 contract…');

// ─── 1. Identity — login via magic-link + dev-token exchange ───
const email = 'alice-vault-' + Date.now() + '@test.local';
const magicRes = await post(BFF, '/api/v1/identity/magic-link', { email });
check(
  'POST /api/v1/identity/magic-link → 200',
  magicRes.status === 200,
  `status=${magicRes.status}`,
);
check('magic-link response sent=true', magicRes.body?.sent === true, `sent=${magicRes.body?.sent}`);

// Fetch dev token from BFF-proxied dev-tokens route (IDENTITY_DEV_TOKENS=true).
const devTokens = await get(BFF, '/api/v1/identity/dev-tokens');
check(
  'GET /api/v1/identity/dev-tokens → 200',
  devTokens.status === 200,
  `status=${devTokens.status}`,
);
const rawToken = devTokens.body?.tokens?.[email];
check(
  'dev token present for our email',
  typeof rawToken === 'string' && rawToken.length > 0,
  `token=${rawToken?.slice(0, 8)}`,
);

const exchangeRes = await post(BFF, '/api/v1/identity/exchange', { email, token: rawToken });
check(
  'POST /api/v1/identity/exchange → 200',
  exchangeRes.status === 200,
  `status=${exchangeRes.status}`,
);
check(
  'exchange returns sessionToken',
  typeof exchangeRes.body?.sessionToken === 'string' && exchangeRes.body.sessionToken.length > 0,
);
check('exchange returns citizen.id', typeof exchangeRes.body?.citizen?.id === 'string');
check(
  'exchange returns citizen.identityLevel=verified_resident',
  exchangeRes.body?.citizen?.identityLevel === 'verified_resident',
);

const sessionToken = exchangeRes.body.sessionToken;
const _citizenId = exchangeRes.body.citizen.id;
const auth = { authorization: 'Bearer ' + sessionToken };

// ─── 2. Seed proof manifest + add vault document ───
const proofManifestId = 'pm-vault-' + Date.now();
const manifestHash = 'sha256:' + 'a'.repeat(64); // deterministic test hash
const seedManifest = await post(PROOF, '/internal/proofs/manifests', {
  originalFileHash: 'sha256:' + 'b'.repeat(64),
  manifestHash,
  documentClass: 'citizen-private-document',
  issuerId: 'issuer-vault-test',
  issuerName: 'Vault Test Authority',
  contentVisibility: 'public',
  proofVisibility: 'public',
});
check('seed proof manifest → 201', seedManifest.status === 201, `status=${seedManifest.status}`);
// Use the actual returned id (the proof-service assigns uuid).
const actualManifestId = seedManifest.body?.id ?? proofManifestId;

const addDoc = await post(
  BFF,
  '/api/v1/vault/documents',
  {
    proofManifestId: actualManifestId,
    label: 'My residence certificate',
  },
  auth,
);
check('POST /api/v1/vault/documents → 201', addDoc.status === 201, `status=${addDoc.status}`);
check('vault document has id + proofManifestId', addDoc.body?.id && addDoc.body?.proofManifestId);

const listDocs = await get(BFF, '/api/v1/vault/documents', auth);
check('GET /api/v1/vault/documents → 200', listDocs.status === 200, `status=${listDocs.status}`);
check(
  'vault documents list has ≥1 item',
  Array.isArray(listDocs.body?.items) && listDocs.body.items.length >= 1,
);
const vaultDocId = listDocs.body?.items?.[0]?.id;
check(
  'vault document has proof.issuerName',
  listDocs.body?.items?.[0]?.proof?.issuerName === 'Vault Test Authority',
);

// ─── 3. Grant + verify in scope (criterion: grantee verifies within scope) ───
const createGrant = await post(
  BFF,
  '/api/v1/vault/grants',
  {
    grantee: { type: 'institution', id: 'inst-complaints-office' },
    purpose: 'Benefits verification',
    scope: 'proof_only',
    vaultDocumentId: vaultDocId,
  },
  auth,
);
check(
  'POST /api/v1/vault/grants proof_only → 201',
  createGrant.status === 201,
  `status=${createGrant.status}`,
);
check(
  'grant has id + scope=proof_only',
  createGrant.body?.id && createGrant.body?.scope === 'proof_only',
);
const grantId = createGrant.body?.id ?? '';

const verifyRes = await post(BFF, '/api/v1/vault/verify', { grantId });
check('POST /api/v1/vault/verify → 200', verifyRes.status === 200, `status=${verifyRes.status}`);
check('verify returns verdict', typeof verifyRes.body?.verdict === 'string');
check(
  'verify returns manifestHash',
  verifyRes.body?.manifestHash === manifestHash,
  `manifestHash=${verifyRes.body?.manifestHash}`,
);
check('verify returns issuerName', verifyRes.body?.issuerName === 'Vault Test Authority');

// ─── 4. Proof-only leak guard (structural: no document bytes) ───
const verifyStr = JSON.stringify(verifyRes.body);
check('verify body contains no url field', !verifyStr.includes('"url"'));
check('verify body contains no originalFilename', !verifyStr.includes('originalFilename'));
check('verify body contains no ocrText', !verifyStr.includes('ocrText'));

// ─── 5. Access events visible (criterion) ───
const eventsRes = await get(BFF, '/api/v1/vault/access-events', auth);
check(
  'GET /api/v1/vault/access-events → 200',
  eventsRes.status === 200,
  `status=${eventsRes.status}`,
);
const eventTypes = (eventsRes.body?.items ?? []).map((e) => e.event);
check('access events contain grant event', eventTypes.includes('grant'));
check('access events contain access event (from verify)', eventTypes.includes('access'));

// ─── 6. Revoke (criterion: user can grant/revoke access) ───
const revokeRes = await del(BFF, '/api/v1/vault/grants/' + grantId, auth);
check(
  'DELETE /api/v1/vault/grants/:id → 200',
  revokeRes.status === 200,
  `status=${revokeRes.status}`,
);
check('revoked grant status=revoked', revokeRes.body?.status === 'revoked');

const verifyRevoked = await post(BFF, '/api/v1/vault/verify', { grantId });
check('verify revoked grant → 403', verifyRevoked.status === 403, `status=${verifyRevoked.status}`);

const eventsAfterRevoke = await get(BFF, '/api/v1/vault/access-events', auth);
const eventsAfter = (eventsAfterRevoke.body?.items ?? []).map((e) => e.event);
check('access events contain revoke event', eventsAfter.includes('revoke'));

// ─── 7. VC issuance (deliverable: proof-only sharing) ───
const vcGrant = await post(
  BFF,
  '/api/v1/vault/grants',
  {
    grantee: { type: 'partner', id: 'partner-verify-co' },
    purpose: 'Proof verification',
    scope: 'vc_presentation',
    vaultDocumentId: vaultDocId,
  },
  auth,
);
check(
  'POST /api/v1/vault/grants vc_presentation → 201',
  vcGrant.status === 201,
  `status=${vcGrant.status}`,
);
const vcGrantId = vcGrant.body?.id ?? '';

// Issue VC directly via vc-issuer-service (the vault-service passes grant data).
const vcIssue = await post(VC_ISSUER, '/internal/vc/issue', {
  grantId: vcGrantId,
  proofManifestId: actualManifestId,
  manifestHash,
  issuerName: 'Vault Test Authority',
  scope: 'vc_presentation',
});
check('POST /internal/vc/issue → 201', vcIssue.status === 201, `status=${vcIssue.status}`);
check('VC has type VerifiableCredential', vcIssue.body?.vc?.type?.includes('VerifiableCredential'));
check(
  'VC credentialSubject has manifestHash',
  vcIssue.body?.vc?.credentialSubject?.manifestHash === manifestHash,
);
const vcStr = JSON.stringify(vcIssue.body?.vc?.credentialSubject ?? {});
check(
  'VC credentialSubject contains no document bytes',
  !vcStr.includes('originalFilename') && !vcStr.includes('ocrText'),
);
const vcId = vcIssue.body?.id ?? '';

// Verify VC via GET /api/v1/vc/:id (BFF → vc-issuer).
const vcGet = await get(BFF, '/api/v1/vc/' + vcId);
check('GET /api/v1/vc/:id → 200', vcGet.status === 200, `status=${vcGet.status}`);
check('VC GET returns vc + status', vcGet.body?.vc && vcGet.body?.status);

// ─── 8. Auth gate ───
const noAuth = await get(BFF, '/api/v1/vault/documents');
check(
  'GET /api/v1/vault/documents no session → 401',
  noAuth.status === 401,
  `status=${noAuth.status}`,
);

const badAuth = await post(
  BFF,
  '/api/v1/vault/grants',
  {
    grantee: { type: 'institution', id: 'x' },
    purpose: 'test',
    scope: 'proof_only',
  },
  { authorization: 'Bearer bad-token' },
);
check(
  'POST /api/v1/vault/grants bad token → 401',
  badAuth.status === 401,
  `status=${badAuth.status}`,
);

// Internal vault routes not reachable via BFF (no public /internal/vault/* proxy).
const internalDocs = await get(BFF, '/internal/vault/documents');
check(
  'GET /internal/vault/documents via BFF → 404',
  internalDocs.status === 404,
  `status=${internalDocs.status}`,
);

// ─── 9. Health ───
const healthIdentity = await get(IDENTITY, '/healthz');
check(
  'citizen-identity-service /healthz ok',
  healthIdentity.body?.status === 'ok',
  `status=${healthIdentity.status}`,
);
const healthVault = await get(VAULT, '/healthz');
check(
  'citizen-vault-service /healthz ok',
  healthVault.body?.status === 'ok',
  `status=${healthVault.status}`,
);
const healthVc = await get(VC_ISSUER, '/healthz');
check('vc-issuer-service /healthz ok', healthVc.body?.status === 'ok', `status=${healthVc.status}`);

console.log(`[phase8] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

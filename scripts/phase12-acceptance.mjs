import { withInternalHeaders } from './internal-headers.mjs';

// Phase 12 (M12) acceptance: exercises the real RFC 3161 timestamp + real CMS
// e-seal proof path end-to-end against a running TIMESTAMP_MODE=real
// SIGNATURE_MODE=real stack. Drives the ingestion gateway + public BFF — no
// browser. The dev TSA (sigstore/timestamp-authority, in-memory key) and the
// committed dev institutional seal produce genuine, validating cryptographic
// material; the stub paths stay byte-identical and remain the default.
//
// Verifies the M12 contract (spec §15.6 + §15.7, minimal seam D1):
//   1. Upload → ingestion gateway 201 + manifest (id + hashes.originalFileHash).
//   2. GET proof carries a REAL signature: standard 'eIDAS-eSeal' (≠ test-key),
//      signerRef ≠ test-signer-stub-ed25519, validationStatus valid, non-empty
//      signatureValueRef (base64 DER CMS ContentInfo).
//   3. GET proof carries a REAL timestamp: type 'RFC3161', tsa containing the
//      real TSA host (≠ polis-stub-tsa), validationStatus valid, non-empty
//      timestampRef (base64 DER CMS token).
//   4. TSA reachable + real: GET TSA /api/v1/timestamp/certchain → 200.
//   5. §15 manifest still verifies valid by hash (manifest id round-trips).
//   6. Audit carries proof.signature.created + proof.timestamp.created with the
//      real standard / tsa.
const INGESTION = process.env.INGESTION_URL ?? 'http://localhost:8400';
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
// Script-specific namespace — the host PAPERLESS_*/TSA_* env is polluted (M11).
const TSA_CERTCHAIN =
  process.env.PHASE12_TSA_CERTCHAIN_URL ?? 'http://localhost:3002/api/v1/timestamp/certchain';
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

console.log('[phase12] checking M12 RFC 3161 timestamp + CMS e-seal real backend…');

// Run-unique content so a partial re-run never collides with stale manifests.
const contentBase64 = Buffer.from('M12 acceptance document ' + Date.now()).toString('base64');

// ─── 1. Upload via the internal ingestion gateway ───
const uploaded = await post(INGESTION, '/internal/ingestion/documents', {
  contentBase64,
  filename: 'm12-acceptance.txt',
  documentClass: 'public-government-record',
});
check(
  'POST /internal/ingestion/documents → 201',
  uploaded.status === 201,
  `status=${uploaded.status}`,
);
const manifestId = uploaded.body?.id ?? '';
const originalFileHash = uploaded.body?.hashes?.originalFileHash ?? '';
check(
  'uploaded manifest has id',
  !!manifestId,
  `body=${JSON.stringify(uploaded.body ?? {}).slice(0, 200)}`,
);
check(
  'uploaded manifest has hashes.originalFileHash',
  !!originalFileHash,
  `hashes=${uploaded.body?.hashes ? Object.keys(uploaded.body.hashes).join(',') : 'null'}`,
);

// ─── 2. Real signature + real timestamp on the proof ───
const proof = manifestId
  ? await get(BFF, `/api/v1/proofs/${manifestId}`)
  : { status: 0, body: null };
check('GET /api/v1/proofs/<id> → 200', proof.status === 200, `status=${proof.status}`);

const signatures = Array.isArray(proof.body?.signatures) ? proof.body.signatures : [];
const sig = signatures[0];
check('proof has exactly 1 signature', signatures.length === 1, `count=${signatures.length}`);
check(
  'signature.standard is eIDAS-eSeal (≠ test-key)',
  sig?.standard === 'eIDAS-eSeal',
  `standard=${sig?.standard}`,
);
check(
  'signature.signerRef is the real dev seal (≠ test-signer-stub-ed25519)',
  !!sig?.signerRef && sig.signerRef !== 'test-signer-stub-ed25519',
  `signerRef=${sig?.signerRef}`,
);
check(
  'signature.validationStatus is valid',
  sig?.validationStatus === 'valid',
  `status=${sig?.validationStatus}`,
);
check('signature has non-empty signatureValueRef', !!sig?.signatureValueRef, '');

const timestamps = Array.isArray(proof.body?.timestamps) ? proof.body.timestamps : [];
const ts = timestamps[0];
check('proof has exactly 1 timestamp', timestamps.length === 1, `count=${timestamps.length}`);
check('timestamp.type is RFC3161', ts?.type === 'RFC3161', `type=${ts?.type}`);
check(
  'timestamp.tsa is the real TSA (≠ polis-stub-tsa)',
  !!ts?.tsa && ts.tsa !== 'polis-stub-tsa',
  `tsa=${ts?.tsa}`,
);
check(
  'timestamp.validationStatus is valid',
  ts?.validationStatus === 'valid',
  `status=${ts?.validationStatus}`,
);
check('timestamp has non-empty timestampRef', !!ts?.timestampRef, '');

// ─── 3. TSA reachable + real (dev cert chain exists) ───
const ccRes = await fetch(TSA_CERTCHAIN);
check('GET TSA /api/v1/timestamp/certchain → 200', ccRes.ok, `status=${ccRes.status}`);

// ─── 4. §15 manifest still verifies valid by hash ───
const hashVerify = originalFileHash
  ? await post(BFF, '/api/v1/verify/hash', { hash: originalFileHash })
  : { status: 0, body: null };
check(
  'POST /api/v1/verify/hash → status valid',
  hashVerify.body?.status === 'valid',
  `status=${hashVerify.body?.status}`,
);
check(
  'verify/hash manifest.id matches uploaded manifest',
  hashVerify.body?.manifest?.id === manifestId,
  `got=${hashVerify.body?.manifest?.id}`,
);

// ─── 5. Audit carries the real signature + timestamp events ───
const audit = manifestId
  ? await get(BFF, `/api/v1/audit/proof/${manifestId}`)
  : { status: 0, body: null };
check('GET /api/v1/audit/proof/<id> → 200', audit.status === 200, `status=${audit.status}`);
const auditItems = Array.isArray(audit.body?.items) ? audit.body.items : [];
const eventTypes = auditItems.map((e) => e.eventType);
check(
  'audit includes proof.signature.created',
  eventTypes.includes('proof.signature.created'),
  `events=${eventTypes.join(',')}`,
);
check(
  'audit includes proof.timestamp.created',
  eventTypes.includes('proof.timestamp.created'),
  `events=${eventTypes.join(',')}`,
);
const sigAudit = auditItems.find((e) => e.eventType === 'proof.signature.created');
check(
  'audit signature event carries real standard',
  sigAudit?.data?.standard === 'eIDAS-eSeal',
  `standard=${sigAudit?.data?.standard}`,
);
const tsAudit = auditItems.find((e) => e.eventType === 'proof.timestamp.created');
check(
  'audit timestamp event carries real tsa',
  !!tsAudit?.data?.tsa && tsAudit.data.tsa !== 'polis-stub-tsa',
  `tsa=${tsAudit?.data?.tsa}`,
);

console.log(`[phase12] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

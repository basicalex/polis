import { withInternalHeaders } from './internal-headers.mjs';

// Phase 11 (M11) acceptance: exercises the real Paperless-ngx upload→verify
// path end-to-end against a running PAPERLESS_MODE=http stack. Drives the
// ingestion gateway directly — the upload surface is internal-only by design
// (no public BFF upload route in M11; a public upload carries auth/abuse
// decisions outside "replace the stub adapter").
//
// Verifies the M11 contract:
//   1. Upload → ingestion gateway 201 + manifest (id + hashes.originalFileHash).
//   2. Document materialised in Paperless (resolved by deterministic ASN).
//   3. document.paperless.linked audit event fired (observable doc-id link).
//   4. §15 manifest verifies valid by hash (manifest id round-trips).
//   5. Idempotency: re-uploading the same bytes does NOT duplicate the Paperless
//      document (HttpPaperlessClient preflight returns the existing doc by ASN).
//      (Proof manifests are append-only by design — a re-upload mints a fresh
//      manifest row; the M11 idempotency guarantee is the no-dup DOCUMENT, not a
//      shared manifest id. proof_manifests.original_file_hash is a plain index.)
import { createHash } from 'node:crypto';

const INGESTION = process.env.INGESTION_URL ?? 'http://localhost:8400';
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const PAPERLESS = process.env.PHASE11_PAPERLESS_URL ?? 'http://localhost:8001';
const PAPERLESS_TOKEN = process.env.PAPERLESS_API_TOKEN ?? 'polis-paperless-dev-token';
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

// Mirror of HttpPaperlessClient.deterministicAsn — a content-keyed ASN lets the
// script find the created Paperless doc without parsing the async task id.
function deterministicAsn(contentBase64) {
  const hex = createHash('sha256').update(contentBase64).digest('hex');
  return parseInt(hex.slice(0, 8), 16) & 0x7fffffff;
}

console.log('[phase11] checking M11 Paperless-ngx real backend…');

// Run-unique content so a lingering doc from a prior partial run never collides
// (the preflight makes consume idempotent regardless).
const contentBase64 = Buffer.from('M11 acceptance document ' + Date.now()).toString('base64');
const asn = deterministicAsn(contentBase64);

// ─── 1. Upload via the internal ingestion gateway ───
const uploaded = await post(INGESTION, '/internal/ingestion/documents', {
  contentBase64,
  filename: 'm11-acceptance.txt',
  documentClass: 'public-government-record',
});
check('POST /internal/ingestion/documents → 201', uploaded.status === 201, `status=${uploaded.status}`);
const manifestId = uploaded.body?.id ?? '';
const originalFileHash = uploaded.body?.hashes?.originalFileHash ?? '';
check('uploaded manifest has id', !!manifestId, `body=${JSON.stringify(uploaded.body ?? {}).slice(0, 200)}`);
check(
  'uploaded manifest has hashes.originalFileHash',
  !!originalFileHash,
  `hashes=${uploaded.body?.hashes ? Object.keys(uploaded.body.hashes).join(',') : 'null'}`,
);

// ─── 2. Document materialised in Paperless (resolved by ASN) ───
const paperlessDoc = await get(
  PAPERLESS,
  `/api/documents/?archive_serial_number=${asn}&page_size=1`,
  { authorization: `Token ${PAPERLESS_TOKEN}` },
);
check(
  'GET Paperless /api/documents/?archive_serial_number=<asn> → 200',
  paperlessDoc.status === 200,
  `status=${paperlessDoc.status}`,
);
const paperlessResults = Array.isArray(paperlessDoc.body?.results) ? paperlessDoc.body.results : [];
check('Paperless has exactly 1 doc for the ASN', paperlessResults.length === 1, `count=${paperlessResults.length}`);
const paperlessDocumentId = paperlessResults[0] ? String(paperlessResults[0].id) : '';
check('Paperless doc id resolved', !!paperlessDocumentId, '');

// ─── 3. document.paperless.linked audit event fired ───
const audit = paperlessDocumentId
  ? await get(BFF, `/api/v1/audit/document/${paperlessDocumentId}`)
  : { status: 0, body: null };
check('GET /api/v1/audit/document/<paperlessId> → 200', audit.status === 200, `status=${audit.status}`);
const auditItems = Array.isArray(audit.body?.items) ? audit.body.items : [];
const eventTypes = auditItems.map((e) => e.eventType);
check(
  'audit includes document.paperless.linked',
  eventTypes.includes('document.paperless.linked'),
  `events=${eventTypes.join(',')}`,
);

// ─── 4. §15 manifest verifies valid by hash ───
const hashVerify = originalFileHash
  ? await post(BFF, '/api/v1/verify/hash', { hash: originalFileHash })
  : { status: 0, body: null };
check('POST /api/v1/verify/hash → status valid', hashVerify.body?.status === 'valid', `status=${hashVerify.body?.status}`);
check(
  'verify/hash manifest.id matches uploaded manifest',
  hashVerify.body?.manifest?.id === manifestId,
  `got=${hashVerify.body?.manifest?.id}`,
);

// ─── 5. Idempotency: re-upload the same bytes ───
// The M11 guarantee: HttpPaperlessClient.consume's ASN preflight returns the
// existing Paperless doc, so Paperless gains NO duplicate. Re-querying the ASN
// must still yield exactly one document.
const reuploaded = await post(INGESTION, '/internal/ingestion/documents', {
  contentBase64,
  filename: 'm11-acceptance.txt',
  documentClass: 'public-government-record',
});
check('idempotent re-upload → 201', reuploaded.status === 201, `status=${reuploaded.status}`);
check('re-upload returns a manifest id', !!reuploaded.body?.id, `body=${JSON.stringify(reuploaded.body ?? {}).slice(0, 120)}`);
// The re-uploaded manifest still verifies valid; verify/hash resolves to the
// latest active manifest (append-only — a new row per upload, latest by createdAt).
const reverify = reuploaded.body?.id
  ? await post(BFF, '/api/v1/verify/hash', { hash: originalFileHash })
  : { status: 0, body: null };
check('re-upload verify/hash → status valid', reverify.body?.status === 'valid', `status=${reverify.body?.status}`);
check(
  're-upload verify/hash resolves to the latest (re-uploaded) manifest id',
  reverify.body?.manifest?.id === reuploaded.body?.id,
  `got=${reverify.body?.manifest?.id} expected=${reuploaded.body?.id}`,
);

const paperlessAfter = await get(
  PAPERLESS,
  `/api/documents/?archive_serial_number=${asn}&page_size=5`,
  { authorization: `Token ${PAPERLESS_TOKEN}` },
);
const resultsAfter = Array.isArray(paperlessAfter.body?.results) ? paperlessAfter.body.results : [];
check(
  'Paperless still has exactly 1 doc for the ASN after re-upload (no duplicate)',
  resultsAfter.length === 1,
  `count=${resultsAfter.length}`,
);

console.log(`[phase11] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

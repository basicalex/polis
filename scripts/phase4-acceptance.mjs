import { withInternalHeaders } from './internal-headers.mjs';

// Phase 4 (M4) acceptance: exercises the §30.5 timestamp + signature v0.1
// contract end-to-end against a running stack (document-ingestion-gateway
// :8400 orchestrating proof-service :8700 + signature-service :8900 +
// timestamp-service :8800, platform-api BFF :8080, seeded Postgres).
//
// Verifies:
//   1. Uploading a document yields a proof with a valid test-key signature
//      and a valid RFC3161-stub timestamp (orchestration await).
//   2. BFF proof read carries the signature + timestamp arrays.
//   3-7. Supersession: supersede doc A with doc B → A reports 'superseded'
//        with supersededBy populated on both the full read and the status
//        read; B stays 'active'.
//   8. Revocation: revoke doc C → C reports 'revoked'.
//   9. Precedence: a proof that is both superseded AND revoked reports
//      'revoked' (revocation > supersession) with supersededBy still set.
//  10. Issuer self-seeding: GET issuer returns standard='test-key'.
//  11. Health: signature-service + timestamp-service /healthz ok.
//
// Run AFTER `docker compose up -d --wait` (or dev-services).
const INGESTION = process.env.INGESTION_INTERNAL_URL ?? 'http://localhost:8400';
const PROOF = process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700';
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const SIGNATURE = process.env.SIGNATURE_INTERNAL_URL ?? 'http://localhost:8900';
const TIMESTAMP = process.env.TIMESTAMP_INTERNAL_URL ?? 'http://localhost:8800';

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
  const r = await fetch(base + path, { headers: withInternalHeaders(path) });
  return { status: r.status, body: r.ok ? await r.json() : null };
}
async function post(base, path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: withInternalHeaders(path, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

function upload(text) {
  return post(INGESTION, '/internal/ingestion/documents', {
    contentBase64: Buffer.from(text).toString('base64'),
    filename: 'm4-demo.txt',
    documentClass: 'public-government-record',
  });
}

console.log('[phase4] checking §30.5 timestamp + signature v0.1 contract…');

// 1. Upload doc A → proof with signature + timestamp (orchestration await).
const docA = await upload('M4 supersession source document\n');
const proofIdA = docA.body?.id ?? '';
check('POST /internal/ingestion/documents (A) → 201', docA.status === 201, `status=${docA.status}`);
check(
  'uploaded proof A has signature validationStatus valid',
  docA.body?.signatures?.[0]?.validationStatus === 'valid',
  `signatures=${JSON.stringify(docA.body?.signatures ?? [])}`,
);
check(
  'uploaded proof A signature standard is test-key',
  docA.body?.signatures?.[0]?.standard === 'test-key',
  `standard=${docA.body?.signatures?.[0]?.standard}`,
);
check(
  'uploaded proof A has timestamp validationStatus valid',
  docA.body?.timestamps?.[0]?.validationStatus === 'valid',
  `timestamps=${JSON.stringify(docA.body?.timestamps ?? [])}`,
);
check(
  'uploaded proof A timestamp type is RFC3161',
  docA.body?.timestamps?.[0]?.type === 'RFC3161',
  `type=${docA.body?.timestamps?.[0]?.type}`,
);

// 2. BFF proof read → carries sig + ts arrays, no supersession.
const readA = proofIdA ? await get(BFF, '/api/v1/proofs/' + proofIdA) : { status: 0, body: null };
check(
  'GET /api/v1/proofs/A → signatures length 1',
  readA.body?.signatures?.length === 1,
  `len=${readA.body?.signatures?.length}`,
);
check(
  'GET /api/v1/proofs/A → timestamps length 1',
  readA.body?.timestamps?.length === 1,
  `len=${readA.body?.timestamps?.length}`,
);
check(
  'GET /api/v1/proofs/A → supersededBy null',
  readA.body?.supersededBy === null,
  `supersededBy=${readA.body?.supersededBy}`,
);

// 3. Upload doc B → capture proofIdB.
const docB = await upload('M4 supersession target document\n');
const proofIdB = docB.body?.id ?? '';
check('POST /internal/ingestion/documents (B) → 201', docB.status === 201, `status=${docB.status}`);

// 4. Supersede A with B (internal route on PROOF).
const supA = proofIdA
  ? await post(PROOF, '/internal/proofs/' + proofIdA + '/supersede', {
      supersedingProofId: proofIdB,
      reason: 'newer version',
    })
  : { status: 0, body: null };
check('POST /internal/proofs/A/supersede → 201', supA.status === 201, `status=${supA.status}`);

// 5. BFF proof read A → superseded by B, registryStatus superseded.
const readA2 = proofIdA ? await get(BFF, '/api/v1/proofs/' + proofIdA) : { status: 0, body: null };
check(
  'GET /api/v1/proofs/A (after supersede) → supersededBy = B',
  readA2.body?.supersededBy === proofIdB,
  `got=${readA2.body?.supersededBy}`,
);
check(
  'GET /api/v1/proofs/A (after supersede) → registryStatus superseded',
  readA2.body?.registryStatus === 'superseded',
  `registryStatus=${readA2.body?.registryStatus}`,
);

// 6. BFF status read A → effective status superseded + supersededBy.
const statusA = proofIdA
  ? await get(BFF, '/api/v1/proofs/' + proofIdA + '/status')
  : { status: 0, body: null };
check(
  'GET /api/v1/proofs/A/status → registryStatus superseded',
  statusA.body?.registryStatus === 'superseded',
  `registryStatus=${statusA.body?.registryStatus}`,
);
check(
  'GET /api/v1/proofs/A/status → supersededBy = B',
  statusA.body?.supersededBy === proofIdB,
  `supersededBy=${statusA.body?.supersededBy}`,
);

// 7. BFF proof read B → active, no supersession.
const readB = proofIdB ? await get(BFF, '/api/v1/proofs/' + proofIdB) : { status: 0, body: null };
check(
  'GET /api/v1/proofs/B → supersededBy null',
  readB.body?.supersededBy === null,
  `supersededBy=${readB.body?.supersededBy}`,
);
check(
  'GET /api/v1/proofs/B → registryStatus active',
  readB.body?.registryStatus === 'active',
  `registryStatus=${readB.body?.registryStatus}`,
);

// 8. Revocation: upload C, revoke it, assert revoked.
const docC = await upload('M4 revocation target document\n');
const proofIdC = docC.body?.id ?? '';
check('POST /internal/ingestion/documents (C) → 201', docC.status === 201, `status=${docC.status}`);
const revC = proofIdC
  ? await post(PROOF, '/internal/proofs/' + proofIdC + '/revoke', { reason: 'withdrawn' })
  : { status: 0, body: null };
check('POST /internal/proofs/C/revoke → 201', revC.status === 201, `status=${revC.status}`);
const statusC = proofIdC
  ? await get(BFF, '/api/v1/proofs/' + proofIdC + '/status')
  : { status: 0, body: null };
check(
  'GET /api/v1/proofs/C/status → registryStatus revoked',
  statusC.body?.registryStatus === 'revoked',
  `registryStatus=${statusC.body?.registryStatus}`,
);
const readC = proofIdC ? await get(BFF, '/api/v1/proofs/' + proofIdC) : { status: 0, body: null };
check(
  'GET /api/v1/proofs/C → registryStatus revoked',
  readC.body?.registryStatus === 'revoked',
  `registryStatus=${readC.body?.registryStatus}`,
);

// 9. Precedence: revoke A (already superseded by B) → revoked wins, supersededBy preserved.
const revA = proofIdA
  ? await post(PROOF, '/internal/proofs/' + proofIdA + '/revoke', { reason: 'also withdrawn' })
  : { status: 0, body: null };
check(
  'POST /internal/proofs/A/revoke (already superseded) → 201',
  revA.status === 201,
  `status=${revA.status}`,
);
const statusA2 = proofIdA
  ? await get(BFF, '/api/v1/proofs/' + proofIdA + '/status')
  : { status: 0, body: null };
check(
  'GET /api/v1/proofs/A/status (revoked+superseded) → registryStatus revoked',
  statusA2.body?.registryStatus === 'revoked',
  `registryStatus=${statusA2.body?.registryStatus}`,
);
check(
  'GET /api/v1/proofs/A/status (revoked+superseded) → supersededBy still B',
  statusA2.body?.supersededBy === proofIdB,
  `supersededBy=${statusA2.body?.supersededBy}`,
);

// 10. Issuer self-seeded by signature-service.
const issuer = await get(BFF, '/api/v1/issuers/issuer-demo-authority');
check(
  'GET /api/v1/issuers/issuer-demo-authority → standard test-key',
  issuer.body?.standard === 'test-key',
  `standard=${issuer.body?.standard}`,
);

// 11. Health: both new services.
const sigHealth = await get(SIGNATURE, '/healthz');
check(
  'signature-service /healthz ok',
  sigHealth.body?.status === 'ok',
  `status=${sigHealth.status}`,
);
const tsHealth = await get(TIMESTAMP, '/healthz');
check('timestamp-service /healthz ok', tsHealth.body?.status === 'ok', `status=${tsHealth.status}`);

console.log(`[phase4] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

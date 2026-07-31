import { withInternalHeaders } from './internal-headers.mjs';

// Phase 3 (M3) acceptance: exercises the §14.3 + §30.4 document-proof contract
// end-to-end against a running stack (document-ingestion-gateway :8400,
// proof-service :8700, platform-api BFF :8080, seeded Postgres). Uploads a
// public demo document through the ingestion gateway, asserts a SHA-256 proof
// manifest is created, verifies the same file via the BFF (valid), verifies a
// tampered file (not_found), reads the manifest + status + audit trail back,
// and checks the issuer registry stub.
// Run AFTER `docker compose up -d --wait` (or dev-services).
const INGESTION = process.env.INGESTION_INTERNAL_URL ?? 'http://localhost:8400';
const PROOF = process.env.PROOF_INTERNAL_URL ?? 'http://localhost:8700';
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

console.log('[phase3] checking §14.3 + §30.4 document proof verifier contract…');

const demoContent = 'M3 public demo document — Polis Interface proof verifier\n';
const contentBase64 = Buffer.from(demoContent).toString('base64');

// 1. Upload a public demo document → ingestion gateway orchestrates the pipeline.
const uploaded = await post(INGESTION, '/internal/ingestion/documents', {
  contentBase64,
  filename: 'demo.txt',
  documentClass: 'public-government-record',
  issuerId: 'issuer-demo-authority',
  issuerName: 'Polis Interface Demo Authority',
});
check(
  'POST /internal/ingestion/documents → 201',
  uploaded.status === 201,
  `status=${uploaded.status}`,
);
check(
  'uploaded manifest has id',
  !!uploaded.body?.id,
  `keys=${uploaded.body ? Object.keys(uploaded.body).join(',') : 'null'}`,
);
check(
  'uploaded manifest has hashes.originalFileHash',
  !!uploaded.body?.hashes?.originalFileHash,
  `hashes=${uploaded.body?.hashes ? Object.keys(uploaded.body.hashes).join(',') : 'null'}`,
);
check('uploaded manifest has hashes.manifestHash', !!uploaded.body?.hashes?.manifestHash, '');
check(
  'uploaded manifest registryStatus is active',
  uploaded.body?.registryStatus === 'active',
  `registryStatus=${uploaded.body?.registryStatus}`,
);

const proofId = uploaded.body?.id ?? '';
const originalFileHash = uploaded.body?.hashes?.originalFileHash ?? '';

// 2. BFF verify by hash → valid + manifest id matches.
const hashVerify = proofId
  ? await post(BFF, '/api/v1/verify/hash', { hash: originalFileHash })
  : { status: 0, body: null };
check(
  'POST /api/v1/verify/hash → status valid',
  hashVerify.body?.status === 'valid',
  `status=${hashVerify.body?.status}`,
);
check(
  'verify/hash manifest.id matches uploaded proof',
  hashVerify.body?.manifest?.id === proofId,
  `got=${hashVerify.body?.manifest?.id}`,
);

// 3. BFF verify by file content → valid.
const fileVerify = proofId
  ? await post(BFF, '/api/v1/verify/file', { contentBase64 })
  : { status: 0, body: null };
check(
  'POST /api/v1/verify/file → status valid',
  fileVerify.body?.status === 'valid',
  `status=${fileVerify.body?.status}`,
);

// 4. BFF verify tampered content → not_found (proves the invalid result path).
const tamperedVerify = await post(BFF, '/api/v1/verify/file', {
  contentBase64: Buffer.from('tampered content').toString('base64'),
});
check(
  'POST /api/v1/verify/file tampered → not_found',
  tamperedVerify.body?.status === 'not_found',
  `status=${tamperedVerify.body?.status}`,
);

// 5. BFF proof read → manifest matches.
const proofRead = proofId ? await get(BFF, '/api/v1/proofs/' + proofId) : { status: 0, body: null };
check('GET /api/v1/proofs/:id → 200 with id', !!proofRead.body?.id, `status=${proofRead.status}`);
check(
  'proof read hashes.originalFileHash matches',
  proofRead.body?.hashes?.originalFileHash === originalFileHash,
  `got=${proofRead.body?.hashes?.originalFileHash}`,
);

// 6. BFF proof status → active.
const statusRead = proofId
  ? await get(BFF, '/api/v1/proofs/' + proofId + '/status')
  : { status: 0, body: null };
check(
  'GET /api/v1/proofs/:id/status registryStatus active',
  statusRead.body?.registryStatus === 'active',
  `registryStatus=${statusRead.body?.registryStatus}`,
);

// 7. BFF audit read for the proof target → both proof events present.
const audit = proofId
  ? await get(BFF, '/api/v1/audit/proof/' + proofId)
  : { status: 0, body: null };
const eventTypes = Array.isArray(audit.body?.items) ? audit.body.items.map((e) => e.eventType) : [];
check(
  'GET /api/v1/audit/proof/:id includes proof.manifest.created',
  eventTypes.includes('proof.manifest.created'),
  `events=${eventTypes.join(',')}`,
);
check(
  'GET /api/v1/audit/proof/:id includes proof.verified',
  eventTypes.includes('proof.verified'),
  `events=${eventTypes.join(',')}`,
);

// 8. BFF issuer stub registry.
const issuer = await get(BFF, '/api/v1/issuers/issuer-demo-authority');
check(
  'GET /api/v1/issuers/:id → id + name',
  !!issuer.body?.id && !!issuer.body?.name,
  `keys=${issuer.body ? Object.keys(issuer.body).join(',') : 'null'}`,
);

// 9. Internal proof-service health (smoke that the service is wired in compose).
const proofHealth = await get(PROOF, '/healthz');
check(
  'proof-service /healthz ok',
  proofHealth.body?.status === 'ok',
  `status=${proofHealth.status}`,
);

console.log(`[phase3] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

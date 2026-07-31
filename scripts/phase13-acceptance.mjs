import { withInternalHeaders } from './internal-headers.mjs';

// Phase 13 acceptance: trust-experience frontend. Exercises the shared verdict
// engine end-to-end against a running stack plus the built web + verifier apps.
//
// Contract checked (spec §8.5, §15.3–§15.5):
//   1. Upload a run-unique document via the ingestion gateway, then
//      POST /api/v1/verify/hash with its originalFileHash → status 'valid'.
//   2. Web /verify HTML carries the client-side hashing flow and the
//      proof-not-truth note (§15.4) — no file-upload endpoint anywhere.
//   3. Web /proofs/<id> HTML renders the catalog verdict headline for the
//      uploaded proof.
//   4. Verifier /verify HTML carries the "never uploaded" privacy copy (§15.5)
//      and no verify/file call.
//
// Requires: platform-api (BFF), ingestion gateway, web app, verifier app.
const INGESTION = process.env.INGESTION_URL ?? 'http://localhost:8400';
const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const WEB = process.env.WEB_URL ?? 'http://localhost:4321';
const VERIFIER = process.env.VERIFIER_URL ?? 'http://localhost:4322';

let failures = 0;

function check(label, cond, detail = '') {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${label} ${detail}`);
  } else {
    console.log(`  ok  ${label}`);
  }
}

async function getJson(base, path) {
  const r = await fetch(base + path, { headers: withInternalHeaders(path) });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

async function getHtml(base, path) {
  try {
    const r = await fetch(base + path);
    return { status: r.status, html: await r.text() };
  } catch {
    return { status: 0, html: '' };
  }
}

async function post(base, path, body) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: withInternalHeaders(path, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
}

console.log('[phase13] checking trust-experience frontend…');

// ─── 1. Seed a proof and verify by hash ───
const contentBase64 = Buffer.from('Phase 13 acceptance document ' + Date.now()).toString('base64');
const uploaded = await post(INGESTION, '/internal/ingestion/documents', {
  contentBase64,
  filename: 'phase13-acceptance.txt',
  documentClass: 'public-government-record',
});
check('POST /internal/ingestion/documents → 201', uploaded.status === 201, `status=${uploaded.status}`);
const manifestId = uploaded.body?.id ?? '';
const originalFileHash = uploaded.body?.hashes?.originalFileHash ?? '';
check('uploaded manifest has id + originalFileHash', !!manifestId && !!originalFileHash);

const verified = originalFileHash
  ? await post(BFF, '/api/v1/verify/hash', { hash: originalFileHash })
  : { status: 0, body: null };
check('POST /api/v1/verify/hash → valid', verified.body?.status === 'valid', `status=${verified.body?.status}`);
check(
  'verify/hash manifest round-trips id',
  verified.body?.manifest?.id === manifestId,
  `id=${verified.body?.manifest?.id}`,
);

const unknownHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const notFound = await post(BFF, '/api/v1/verify/hash', { hash: unknownHash });
check('verify/hash for unknown hash → not valid', notFound.body?.status !== 'valid', `status=${notFound.body?.status}`);

// ─── 2. Web /verify page ───
const webVerify = await getHtml(WEB, '/verify');
check('GET web /verify → 200', webVerify.status === 200, `status=${webVerify.status}`);
check('web /verify has verifier flow', /verifier-flow|VerifierFlow/.test(webVerify.html));
check(
  'web /verify carries proof-not-truth note (§15.4)',
  webVerify.html.includes('does not prove the content is true'),
);
check('web /verify never calls verify/file', !webVerify.html.includes('verify/file'));

// ─── 3. Web /proofs/<id> ───
const webProof = manifestId ? await getHtml(WEB, `/proofs/${manifestId}`) : { status: 0, html: '' };
check('GET web /proofs/<id> → 200', webProof.status === 200, `status=${webProof.status}`);
check(
  'web proof page renders catalog verdict headline',
  /Proof valid|Valid, but superseded|Valid, but expired/.test(webProof.html),
);
check('web proof page shows manifest hash', webProof.html.includes(originalFileHash));

// ─── 4. Verifier /verify page ───
const verifierVerify = await getHtml(VERIFIER, '/verify');
check('GET verifier /verify → 200', verifierVerify.status === 200, `status=${verifierVerify.status}`);
check(
  'verifier /verify carries client-side hashing privacy copy (§15.5)',
  verifierVerify.html.includes('never uploaded'),
);
check('verifier /verify never calls verify/file', !verifierVerify.html.includes('verify/file'));

if (failures > 0) {
  console.error(`[phase13] FAILED — ${failures} check(s) failed`);
  process.exit(1);
}
console.log('[phase13] all checks passed');

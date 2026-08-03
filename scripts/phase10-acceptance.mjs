// M10 acceptance: real OIDC auth-code flow against self-hosted Keycloak.
// Drives authorize → Keycloak form login → callback → Polis HMAC session, then
// proves the session reaches a private route and that dev-tokens are stub-only.
//
// Token-translation boundary: Keycloak never reaches a downstream service.
// /callback exchanges the code and mints a Polis session; vault still validates
// the Polis token. This script proves that contract end-to-end.
//
// Requires the compose stack flipped to OIDC with a provisioned Keycloak:
//   IDENTITY_MODE=oidc docker compose -f infra/compose/docker-compose.yml up -d --build
// wait for keycloak-init to exit 0 (realm/client/user created), fresh seed
// (migration 0011 applied), then: node scripts/phase10-acceptance.mjs
//
// Keycloak's login is a standard HTML form, so no headless browser is needed:
// GET the authorize URL (host-reachable via OIDC_AUTHORIZATION_ISSUER), carry
// the session cookie into the form POST, and read the 302 Location for the code.

const BFF = process.env.PUBLIC_API_URL ?? 'http://localhost:8080';
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI ?? 'http://localhost:4321/login/callback';
const OIDC_USER = process.env.OIDC_TEST_USER ?? 'resident@polis.local';
const OIDC_PASS = process.env.OIDC_TEST_PASS ?? 'resident';

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
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(base, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const cookieHeader = (jar) =>
  jar.length ? { cookie: jar.map((c) => c.split(';')[0]).join('; ') } : {};

// GET the Keycloak login page, following internal redirects and accumulating
// Set-Cookie into the jar (Keycloak ties the form POST to the authorize session).
async function getLoginPage(url, jar) {
  let next = url;
  let res;
  for (let i = 0; i < 10; i++) {
    res = await fetch(next, { headers: cookieHeader(jar), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      next = new URL(res.headers.get('location'), next).toString();
      continue;
    }
    return { res, html: await res.text() };
  }
  return { res, html: '' };
}

// Parse the Keycloak login form action + hidden inputs (decode &amp; → &).
function parseLoginForm(html) {
  const formMatch = html.match(/<form[^>]*\saction="([^"]+)"/i);
  const action = formMatch ? formMatch[1].replaceAll('&amp;', '&') : null;
  const hidden = {};
  for (const tag of html.matchAll(/<input[^>]*>/gi)) {
    const t = tag[0];
    if (!/type="hidden"/i.test(t)) continue;
    const n = t.match(/\sname="([^"]+)"/);
    const v = t.match(/\svalue="([^"]*)"/);
    if (n) hidden[n[1]] = v ? v[1] : '';
  }
  return { action, hidden };
}

console.log('[phase10] checking M10 OIDC end-to-end (Keycloak → Polis session)…');

// ─── 1. authorize (BFF → identity-service builds the PKCE auth URL) ───
const authorize = await get(
  BFF,
  '/api/v1/identity/authorize?redirect_uri=' + encodeURIComponent(REDIRECT_URI),
);
check(
  'GET /identity/authorize → 200',
  authorize.status === 200,
  `status=${authorize.status} body=${JSON.stringify(authorize.body)}`,
);
check(
  'authorizationUrl targets the polis realm OIDC auth endpoint',
  typeof authorize.body?.authorizationUrl === 'string' &&
    authorize.body.authorizationUrl.includes('/realms/polis/protocol/openid-connect/auth'),
  `url=${authorize.body?.authorizationUrl ?? ''}`,
);
const issuedState = authorize.body?.state;
check('authorize returns a state', typeof issuedState === 'string' && issuedState.length > 0, '');

// ─── 2-3. Keycloak form login (direct to Keycloak; authorize URL is host-reachable) ───
let code = null;
let returnedState = null;
if (authorize.body?.authorizationUrl) {
  const jar = [];
  const { html } = await getLoginPage(authorize.body.authorizationUrl, jar);
  const { action, hidden } = parseLoginForm(html);
  check('Keycloak login form action parsed', !!action, `html_len=${html.length}`);
  if (action) {
    const formBody = new URLSearchParams({ ...hidden, username: OIDC_USER, password: OIDC_PASS });
    const loginRes = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...cookieHeader(jar) },
      body: formBody.toString(),
      redirect: 'manual',
    });
    const loc = loginRes.headers.get('location');
    check(
      'Keycloak login POST → 3xx',
      loginRes.status >= 300 && loginRes.status < 400,
      `status=${loginRes.status}`,
    );
    check('redirect Location present', !!loc, `loc=${loc ?? ''}`);
    if (loc) {
      const cb = new URL(loc);
      code = cb.searchParams.get('code');
      returnedState = cb.searchParams.get('state');
      check('redirect carries an auth code', !!code, `loc=${loc}`);
      check(
        'redirect state echoes the issued state',
        returnedState === issuedState,
        `issued=${issuedState} returned=${returnedState}`,
      );
    }
  }
}

// ─── 4. callback (BFF → identity-service: code→token→userinfo→resolve citizen→session) ───
const callback = await post(BFF, '/api/v1/identity/callback', {
  code,
  state: returnedState,
  redirectUri: REDIRECT_URI,
});
check(
  'POST /identity/callback → 200',
  callback.status === 200,
  `status=${callback.status} body=${JSON.stringify(callback.body)}`,
);
check(
  'callback returns a session token',
  typeof callback.body?.sessionToken === 'string' && callback.body.sessionToken.length > 0,
  '',
);
check(
  'citizen email matches the IdP user',
  callback.body?.citizen?.email === OIDC_USER,
  `email=${callback.body?.citizen?.email ?? ''}`,
);
check(
  'citizen identityLevel === verified_resident',
  callback.body?.citizen?.identityLevel === 'verified_resident',
  `level=${callback.body?.citizen?.identityLevel ?? ''}`,
);
const sessionToken = callback.body?.sessionToken;
const auth = sessionToken ? { authorization: 'Bearer ' + sessionToken } : {};

// ─── 5. private route proves the minted Polis session is honored downstream ───
const vault = await get(BFF, '/api/v1/vault/documents', auth);
check('GET /vault/documents with session → 200', vault.status === 200, `status=${vault.status}`);

// ─── 6. dev-tokens are stub-only → 404 in OIDC (real-identity) mode ───
const devTokens = await get(BFF, '/api/v1/identity/dev-tokens');
check(
  'GET /identity/dev-tokens → 404 (stub-only)',
  devTokens.status === 404,
  `status=${devTokens.status}`,
);

// ─── 7. regression: public reads unaffected by IDENTITY_MODE ───
const holders = await get(BFF, '/api/v1/mandate-holders');
check(
  'GET /mandate-holders (public read) → 200',
  holders.status === 200,
  `status=${holders.status}`,
);

console.log(`[phase10] ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

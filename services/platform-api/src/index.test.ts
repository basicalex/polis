import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { platformRoutes, withPublicEdge } from './index.js';

test('platform-api exposes §23 public edge routes without network calls', () => {
  const paths = platformRoutes().map((r) => `${r.method} ${r.path}`);
  assert.ok(paths.includes('GET /healthz'));
  assert.ok(paths.includes('GET /version'));
  assert.ok(paths.includes('GET /api/v1/institutions'));
  assert.ok(paths.includes('GET /api/v1/institutions/:id'));
  assert.ok(paths.includes('GET /api/v1/roles/:id'));
  assert.ok(paths.includes('GET /api/v1/processes/:id'));
  assert.ok(paths.includes('GET /api/v1/claims'));
  assert.ok(paths.includes('GET /api/v1/audit/:objectType/:objectId'));
  assert.ok(paths.includes('POST /api/v1/verify/hash'));
  assert.ok(paths.includes('GET /api/v1/mandate-holders'));
  assert.ok(paths.includes('GET /api/v1/mandate-holders/:id'));
  assert.ok(paths.includes('GET /api/v1/mandate-holders/:id/scorecard'));
  assert.ok(paths.includes('GET /api/v1/commitments/:id'));
  assert.ok(paths.includes('GET /api/v1/pilot/charter'));
  assert.ok(paths.includes('GET /api/v1/pilot/results'));
  assert.ok(paths.includes('POST /api/v1/mandate-holders/:id/commitments'));
  assert.ok(paths.includes('POST /api/v1/commitments/:id/resolutions'));
  assert.ok(paths.includes('GET /api/v1/commitments/:id/questions'));
  assert.ok(paths.includes('POST /api/v1/commitments/:id/questions'));
  assert.ok(paths.includes('POST /api/v1/commitment-questions/:id/answers'));
  assert.ok(paths.includes('GET /api/v1/identity/authorize'));
  assert.ok(paths.includes('POST /api/v1/identity/callback'));
  assert.ok(paths.includes('POST /api/v1/mandate-holders/:id/charter-signing-requests'));
  assert.ok(paths.includes('GET /api/v1/mandate-holders/:id/charter-signing-status'));
  assert.ok(paths.includes('POST /api/v1/signing-requests/:id/stub-complete'));
  assert.ok(paths.includes('POST /webhooks/documenso'));
});

test('withPublicEdge is a no-op unless PUBLIC_EDGE=true (reference identity)', () => {
  const base = platformRoutes();
  assert.strictEqual(withPublicEdge(base), base);
});

const mockReq = (
  ip: string,
  init: { method?: string; url?: string; headers?: Record<string, string> } = {},
): IncomingMessage =>
  ({
    method: init.method,
    url: init.url,
    headers: init.headers ?? {},
    socket: { remoteAddress: ip },
  }) as unknown as IncomingMessage;


const fetchHeader = (headers: unknown, name: string): string | undefined => {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (headers && typeof headers === 'object') {
    return (headers as Record<string, string>)[name];
  }
  return undefined;
};

test('withPublicEdge blocks write/login/participation + dev-tokens (PUBLIC_EDGE=true)', async () => {
  process.env.PUBLIC_EDGE = 'true';
  try {
    const routes = withPublicEdge(platformRoutes());
    const find = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.path === path)!;

    // Blocked handlers are pure 405 stubs — safe to invoke, no network.
    const evidenceOut = await find('POST', '/api/v1/contribute/evidence').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
    assert.equal((evidenceOut as { status: number }).status, 405);
    assert.deepEqual((evidenceOut as { body: unknown }).body, {
      error: 'method_not_allowed',
      reason: 'public_edge',
    });

    const devTokensOut = await find('GET', '/api/v1/identity/dev-tokens').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
    assert.equal((devTokensOut as { status: number }).status, 405);

    const mandateCommitmentOut = await find(
      'POST',
      '/api/v1/mandate-holders/:id/commitments',
    ).handler(mockReq('198.51.100.1'), {}, {});
    assert.equal((mandateCommitmentOut as { status: number }).status, 405);

    const resolutionOut = await find(
      'POST',
      '/api/v1/commitments/:id/resolutions',
    ).handler(mockReq('198.51.100.1'), {}, {});
    assert.equal((resolutionOut as { status: number }).status, 405);
    const askOut = await find('POST', '/api/v1/commitments/:id/questions').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
    assert.equal((askOut as { status: number }).status, 405);
    const answerOut = await find('POST', '/api/v1/commitment-questions/:id/answers').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
    assert.equal((answerOut as { status: number }).status, 405);
    const authorizeOut = await find('GET', '/api/v1/identity/authorize').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
    assert.equal((authorizeOut as { status: number }).status, 405);
    const callbackOut = await find('POST', '/api/v1/identity/callback').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
    assert.equal((callbackOut as { status: number }).status, 405);
    for (const [method, path] of [
      ['POST', '/api/v1/mandate-holders/:id/charter-signing-requests'],
      ['GET', '/api/v1/mandate-holders/:id/charter-signing-status'],
      ['POST', '/api/v1/signing-requests/:id/stub-complete'],
      ['POST', '/webhooks/documenso'],
    ] as const) {
      const out = await find(method, path).handler(mockReq('198.51.100.1'), {}, {});
      assert.equal((out as { status: number }).status, 405, `${method} ${path} must be blocked`);
    }

    // verify/hash must remain on the public edge (present + not blocked).
    const verifyHash = routes.find((r) => r.method === 'POST' && r.path === '/api/v1/verify/hash');
    assert.ok(verifyHash, 'POST /api/v1/verify/hash must remain on the public edge');
  } finally {
    delete process.env.PUBLIC_EDGE;
  }
});

test('withPublicEdge wraps non-blocked routes, stubs blocked ones, leaves exempt routes untouched', async () => {
  // Synthetic spy table: no platformRoutes coupling, no network. Proves the
  // verify/hash category (wrapped+rate-limited) without invoking a real proxy.
  process.env.PUBLIC_EDGE = 'true';
  try {
    let spyCalls = 0;
    const spyValue = { ok: true };
    const spy = (): unknown => {
      spyCalls += 1;
      return spyValue;
    };
    const routes = withPublicEdge([
      { method: 'GET', path: '/healthz', handler: spy }, // exempt → unchanged
      { method: 'POST', path: '/api/v1/verify/hash', handler: spy }, // wrapped
      { method: 'POST', path: '/api/v1/contribute/evidence', handler: spy }, // blocked
    ]);
    const find = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.path === path)!;

    // Exempt operational route: handler reference-identical (not wrapped).
    assert.strictEqual(find('GET', '/healthz').handler, spy);

    // Blocked route: returns 405, spy never invoked.
    spyCalls = 0;
    const blocked = await find('POST', '/api/v1/contribute/evidence').handler(
      mockReq('198.51.100.2'),
      {},
      {},
    );
    assert.equal((blocked as { status: number }).status, 405);
    assert.equal(spyCalls, 0);

    // Wrapped route: spy invoked once, return value passed through.
    spyCalls = 0;
    const wrapped = await find('POST', '/api/v1/verify/hash').handler(
      mockReq('198.51.100.3'),
      {},
      {},
    );
    assert.strictEqual(wrapped, spyValue);
    assert.equal(spyCalls, 1);

    // Rate limit engages after 60 calls in the window (default RATE_LIMIT=60).
    spyCalls = 0;
    const ip = '198.51.100.4';
    const first = await find('POST', '/api/v1/verify/hash').handler(mockReq(ip), {}, {});
    assert.strictEqual(first, spyValue); // #1 passes
    for (let i = 1; i < 60; i++) {
      await find('POST', '/api/v1/verify/hash').handler(mockReq(ip), {}, {}); // #2..#60 pass
    }
    const over = await find('POST', '/api/v1/verify/hash').handler(mockReq(ip), {}, {}); // #61
    assert.equal((over as { status: number }).status, 429);
    assert.deepEqual((over as { body: unknown }).body, { error: 'rate_limited' });
    assert.equal(spyCalls, 60);
  } finally {
    delete process.env.PUBLIC_EDGE;
  }
});

test('same-path platform proxy sends the internal token upstream', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalGraphUrl = process.env.GRAPH_INTERNAL_URL;
  const token = 'platform-proxy-token';
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];

  process.env.INTERNAL_API_TOKEN = token;
  process.env.GRAPH_INTERNAL_URL = 'http://graph.internal';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const route = platformRoutes().find(
      (r) => r.method === 'GET' && r.path === '/api/v1/jurisdictions',
    )!;
    const out = await route.handler(
      mockReq('198.51.100.5', {
        method: 'GET',
        url: '/api/v1/jurisdictions?limit=1',
      }),
      undefined,
      {},
    );

    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].input), 'http://graph.internal/api/v1/jurisdictions?limit=1');
    assert.equal(fetchHeader(calls[0].init?.headers, 'x-polis-internal-token'), token);
    assert.equal(fetchHeader(calls[0].init?.headers, 'content-type'), 'application/json');
    assert.equal(JSON.stringify(out).includes(token), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalGraphUrl === undefined) delete process.env.GRAPH_INTERNAL_URL;
    else process.env.GRAPH_INTERNAL_URL = originalGraphUrl;
  }
});

test('citizen-authenticated platform proxy verifies the session and authenticates the internal call', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalVaultUrl = process.env.VAULT_INTERNAL_URL;
  const token = 'platform-citizen-proxy-token';
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];

  process.env.INTERNAL_API_TOKEN = token;
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.VAULT_INTERNAL_URL = 'http://vault.internal';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    const url = String(input);
    if (url === 'http://identity.internal/internal/identity/verify-session') {
      return new Response(
        JSON.stringify({ citizenId: 'citizen-123', identityLevel: 'verified' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify({ documents: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const route = platformRoutes().find(
      (r) => r.method === 'GET' && r.path === '/api/v1/vault/documents',
    )!;
    const out = await route.handler(
      mockReq('198.51.100.6', {
        method: 'GET',
        url: '/api/v1/vault/documents',
        headers: { authorization: 'Bearer session-token' },
      }),
      undefined,
      {},
    );

    assert.equal(calls.length, 2);
    assert.equal(String(calls[0].input), 'http://identity.internal/internal/identity/verify-session');
    assert.equal(fetchHeader(calls[0].init?.headers, 'x-polis-internal-token'), token);
    assert.equal(String(calls[1].input), 'http://vault.internal/internal/vault/documents');
    assert.equal(fetchHeader(calls[1].init?.headers, 'x-polis-internal-token'), token);
    assert.equal(fetchHeader(calls[1].init?.headers, 'x-polis-citizen'), 'citizen-123');
    assert.equal(fetchHeader(calls[1].init?.headers, 'x-polis-identity-level'), 'verified');
    assert.equal(JSON.stringify(out).includes(token), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalVaultUrl === undefined) delete process.env.VAULT_INTERNAL_URL;
    else process.env.VAULT_INTERNAL_URL = originalVaultUrl;
  }
});

test('charter signing initiation requires an idempotency key and forwards the trusted actor', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalSigningUrl = process.env.SIGNING_INTERNAL_URL;
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  process.env.INTERNAL_API_TOKEN = 'platform-signing-test-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.SIGNING_INTERNAL_URL = 'http://signing.internal';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    if (String(input).includes('/verify-session')) {
      return new Response(
        JSON.stringify({ citizenId: 'official-1', identityLevel: 'verified_official' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ id: 'request-1', status: 'created' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const route = platformRoutes().find(
      (r) =>
        r.method === 'POST' &&
        r.path === '/api/v1/mandate-holders/:id/charter-signing-requests',
    );
    assert.ok(route);
    const missing = await route.handler(
      mockReq('198.51.100.7', { headers: { authorization: 'Bearer session' } }),
      {},
      { id: 'holder-1' },
    );
    assert.ok(missing && typeof missing === 'object' && 'status' in missing);
    assert.equal(missing.status, 400);
    assert.equal(calls.length, 1, 'missing key must not reach signing service');

    const accepted = await route.handler(
      mockReq('198.51.100.7', {
        headers: { authorization: 'Bearer session', 'idempotency-key': 'key-1' },
      }),
      {},
      { id: 'holder-1' },
    );
    assert.ok(accepted && typeof accepted === 'object' && 'status' in accepted);
    assert.equal(accepted.status, 201);
    const upstream = calls[2];
    assert.ok(upstream);
    assert.equal(
      String(upstream.input),
      'http://signing.internal/internal/signing/charter-requests',
    );
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-citizen'), 'official-1');
    assert.equal(
      fetchHeader(upstream.init?.headers, 'x-polis-identity-level'),
      'verified_official',
    );
    assert.deepEqual(JSON.parse(String(upstream.init?.body)), {
      mandateHolderId: 'holder-1',
      idempotencyKey: 'key-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalSigningUrl === undefined) delete process.env.SIGNING_INTERNAL_URL;
    else process.env.SIGNING_INTERNAL_URL = originalSigningUrl;
  }
});

test('review routes reject missing and non-staff sessions and strip forged reviewer identity', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalContributionUrl = process.env.CONTRIBUTION_INTERNAL_URL;
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  process.env.INTERNAL_API_TOKEN = 'platform-review-test-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.CONTRIBUTION_INTERNAL_URL = 'http://contribution.internal';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    if (String(input).includes('/verify-session')) {
      const session = JSON.parse(String(init?.body)).sessionToken;
      return new Response(
        JSON.stringify({
          citizenId: session === 'staff-session' ? 'staff-1' : 'citizen-1',
          identityLevel: session === 'staff-session' ? 'staff' : 'verified',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const queue = platformRoutes().find(
      (r) => r.method === 'GET' && r.path === '/api/v1/review/queue',
    );
    const decide = platformRoutes().find(
      (r) => r.method === 'POST' && r.path === '/api/v1/review/:id/decide',
    );
    assert.ok(queue);
    assert.ok(decide);
    const unauthenticated = await queue.handler(mockReq('198.51.100.8'), {}, {});
    assert.ok(
      unauthenticated &&
        typeof unauthenticated === 'object' &&
        'status' in unauthenticated,
    );
    assert.equal(unauthenticated.status, 401);

    const forbidden = await queue.handler(
      mockReq('198.51.100.8', { headers: { authorization: 'Bearer citizen-session' } }),
      {},
      {},
    );
    assert.ok(forbidden && typeof forbidden === 'object' && 'status' in forbidden);
    assert.equal(forbidden.status, 403);

    const reviewed = await decide.handler(
      mockReq('198.51.100.8', { headers: { authorization: 'Bearer staff-session' } }),
      {
        decision: 'approve',
        notes: 'checked',
        reviewerId: 'forged-reviewer',
        reviewerRole: 'reviewer',
      },
      { id: 'submission-1' },
    );
    assert.ok(reviewed && typeof reviewed === 'object' && 'status' in reviewed);
    assert.equal(reviewed.status, 201);
    const upstream = calls.at(-1);
    assert.ok(upstream);
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-citizen'), 'staff-1');
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-identity-level'), 'staff');
    assert.deepEqual(JSON.parse(String(upstream.init?.body)), {
      decision: 'approve',
      notes: 'checked',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalContributionUrl === undefined) delete process.env.CONTRIBUTION_INTERNAL_URL;
    else process.env.CONTRIBUTION_INTERNAL_URL = originalContributionUrl;
  }
});

test('Documenso webhook forwards raw bytes and secret with a bounded raw route', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalSigningUrl = process.env.SIGNING_INTERNAL_URL;
  const token = 'webhook-internal-token';
  let forwarded: RequestInit | undefined;
  process.env.INTERNAL_API_TOKEN = token;
  process.env.SIGNING_INTERNAL_URL = 'http://signing.internal';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    forwarded = init;
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const route = platformRoutes().find(
      (r) => r.method === 'POST' && r.path === '/webhooks/documenso',
    );
    assert.ok(route);
    assert.equal(route.bodyMode, 'raw');
    assert.equal(route.maxBodyBytes, 1_000_000);
    const payload = new Uint8Array([0, 255, 123, 10, 42]);
    const out = await route.handler(
      mockReq('198.51.100.9', {
        headers: { 'x-documenso-secret': 'webhook-secret' },
      }),
      payload,
      {},
    );
    assert.ok(out && typeof out === 'object' && 'status' in out);
    assert.equal(out.status, 202);
    assert.ok(forwarded);
    assert.equal(fetchHeader(forwarded.headers, 'x-polis-internal-token'), token);
    assert.equal(fetchHeader(forwarded.headers, 'x-documenso-secret'), 'webhook-secret');
    assert.deepEqual(new Uint8Array(await new Response(forwarded.body).arrayBuffer()), payload);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalSigningUrl === undefined) delete process.env.SIGNING_INTERNAL_URL;
    else process.env.SIGNING_INTERNAL_URL = originalSigningUrl;
  }
});

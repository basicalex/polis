import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { FetchTimeoutError } from '@polis/service-runtime';
import {
  checkPlatformReadiness,
  parseInternalFetchTimeoutMs,
  platformRoutes,
  runPlatformMigrations,
  validatePlatformConfig,
  withPublicEdge,
} from './index.js';

test('platform startup permits dev and only the approved public-read pilot shape', () => {
  assert.doesNotThrow(() => validatePlatformConfig({ DEPLOYMENT_PROFILE: 'dev' }));
  assert.doesNotThrow(() =>
    validatePlatformConfig({ DEPLOYMENT_PROFILE: 'pilot', PUBLIC_EDGE: 'true' }),
  );
  assert.throws(
    () => validatePlatformConfig({ DEPLOYMENT_PROFILE: 'pilot' }),
    /DEPLOYMENT_PROFILE=pilot requires PUBLIC_EDGE=true/,
  );
  assert.throws(
    () => validatePlatformConfig({ DEPLOYMENT_PROFILE: 'pilot', PUBLIC_EDGE: 'false' }),
    /DEPLOYMENT_PROFILE=pilot requires PUBLIC_EDGE=true/,
  );
});

const expectedRouteSignatures = [
  'GET /healthz',
  'GET /readyz',
  'GET /metrics',
  'GET /version',
  'GET /api/v1/jurisdictions',
  'GET /api/v1/institutions',
  'GET /api/v1/institutions/:id',
  'GET /api/v1/roles/:id',
  'GET /api/v1/processes',
  'GET /api/v1/processes/:id',
  'GET /api/v1/document-types/:id',
  'GET /api/v1/laws/:id',
  'GET /api/v1/budget-lines/:id',
  'GET /api/v1/failure-modes',
  'GET /api/v1/controls',
  'GET /api/v1/proposals/:id',
  'GET /api/v1/assessments/:id',
  'GET /api/v1/claims',
  'GET /api/v1/claims/:id',
  'GET /api/v1/relationships',
  'GET /api/v1/graph/traverse',
  'GET /api/v1/mandate-holders',
  'GET /api/v1/mandate-holders/:id',
  'GET /api/v1/mandate-holders/:id/scorecard',
  'GET /api/v1/commitments/:id',
  'GET /api/v1/commitments/:id/questions',
  'GET /api/v1/issues',
  'GET /api/v1/issues/:id',
  'GET /api/v1/processes/:id/issues',
  'GET /api/v1/issues/:id/conversation',
  'GET /api/v1/audit/:objectType/:objectId',
  'GET /api/v1/proofs/:id',
  'GET /api/v1/proofs/:id/status',
  'GET /api/v1/proofs/:id/audit',
  'GET /api/v1/issuers/:id',
  'POST /api/v1/verify/file',
  'POST /api/v1/verify/hash',
  'POST /api/v1/verify/manifest',
  'POST /api/v1/assistant/ask',
  'GET /api/v1/assistant/traces',
  'GET /api/v1/assistant/traces/:id',
  'GET /api/v1/assistant/outputs/:id',
  'POST /api/v1/assistant/outputs/:id/review',
  'POST /api/v1/contribute/evidence',
  'POST /api/v1/contribute/graph-edit',
  'GET /api/v1/contributions/:id',
  'GET /api/v1/contributors/:id',
  'GET /api/v1/review/queue',
  'POST /api/v1/review/:id/decide',
  'POST /api/v1/complaints',
  'GET /api/v1/complaints/mine',
  'GET /api/v1/complaints/queue',
  'GET /api/v1/complaints/:id',
  'POST /api/v1/complaints/:id/assign',
  'POST /api/v1/complaints/:id/information-requests',
  'POST /api/v1/complaints/:id/information-requests/:requestId/respond',
  'POST /api/v1/complaints/:id/decisions',
  'POST /api/v1/complaints/:id/appeals',
  'POST /api/v1/complaints/:id/appeals/:appealId/decisions',
  'POST /api/v1/complaints/:id/close',
  'GET /api/v1/rewards/rules',
  'GET /api/v1/rewards/public-ledger',
  'POST /api/v1/identity/magic-link',
  'POST /api/v1/identity/exchange',
  'GET /api/v1/identity/authorize',
  'POST /api/v1/identity/callback',
  'GET /api/v1/identity/dev-tokens',
  'GET /api/v1/vault/documents',
  'POST /api/v1/vault/documents',
  'POST /api/v1/vault/grants',
  'DELETE /api/v1/vault/grants/:id',
  'GET /api/v1/vault/access-events',
  'POST /api/v1/vault/verify',
  'GET /api/v1/vc/:id',
  'POST /api/v1/mandate-holders/:id/commitments',
  'POST /api/v1/commitments/:id/resolutions',
  'POST /api/v1/commitments/:id/questions',
  'POST /api/v1/commitment-questions/:id/answers',
  'POST /api/v1/mandate-holders/:id/charter-signing-requests',
  'GET /api/v1/mandate-holders/:id/charter-signing-status',
  'POST /api/v1/signing-requests/:id/stub-complete',
  'POST /webhooks/documenso bodyMode=raw maxBodyBytes=1000000',
  'GET /api/v1/pilot/charter',
  'GET /api/v1/pilot/results',
] as const;

test('platform-api preserves the exact ordered route contract', () => {
  const signatures = platformRoutes().map(
    ({ method, path, bodyMode, maxBodyBytes }) =>
      `${method} ${path}` +
      (bodyMode === undefined ? '' : ` bodyMode=${bodyMode}`) +
      (maxBodyBytes === undefined ? '' : ` maxBodyBytes=${maxBodyBytes}`),
  );
  assert.deepEqual(signatures, expectedRouteSignatures);
});

const complaintRouteKeys = [
  'POST /api/v1/complaints',
  'GET /api/v1/complaints/mine',
  'GET /api/v1/complaints/queue',
  'GET /api/v1/complaints/:id',
  'POST /api/v1/complaints/:id/assign',
  'POST /api/v1/complaints/:id/information-requests',
  'POST /api/v1/complaints/:id/information-requests/:requestId/respond',
  'POST /api/v1/complaints/:id/decisions',
  'POST /api/v1/complaints/:id/appeals',
  'POST /api/v1/complaints/:id/appeals/:appealId/decisions',
  'POST /api/v1/complaints/:id/close',
] as const;

test('platform-api exposes complaints routes in literal-before-id order', () => {
  const paths = platformRoutes().map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(
    paths.filter((path) => path.includes('/api/v1/complaints')),
    complaintRouteKeys,
  );
  assert.ok(
    paths.indexOf('GET /api/v1/complaints/mine') < paths.indexOf('GET /api/v1/complaints/:id'),
  );
  assert.ok(
    paths.indexOf('GET /api/v1/complaints/queue') < paths.indexOf('GET /api/v1/complaints/:id'),
  );
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

const expectedPublicEdgeRoutes = new Set([
  'GET /healthz',
  'GET /readyz',
  'GET /metrics',
  'GET /version',
  'GET /api/v1/jurisdictions',
  'GET /api/v1/institutions',
  'GET /api/v1/institutions/:id',
  'GET /api/v1/roles/:id',
  'GET /api/v1/processes',
  'GET /api/v1/processes/:id',
  'GET /api/v1/document-types/:id',
  'GET /api/v1/laws/:id',
  'GET /api/v1/budget-lines/:id',
  'GET /api/v1/failure-modes',
  'GET /api/v1/controls',
  'GET /api/v1/proposals/:id',
  'GET /api/v1/assessments/:id',
  'GET /api/v1/claims',
  'GET /api/v1/claims/:id',
  'GET /api/v1/relationships',
  'GET /api/v1/graph/traverse',
  'GET /api/v1/mandate-holders',
  'GET /api/v1/mandate-holders/:id',
  'GET /api/v1/mandate-holders/:id/scorecard',
  'GET /api/v1/commitments/:id',
  'GET /api/v1/commitments/:id/questions',
  'GET /api/v1/issues',
  'GET /api/v1/issues/:id',
  'GET /api/v1/processes/:id/issues',
  'GET /api/v1/issues/:id/conversation',
  'GET /api/v1/audit/:objectType/:objectId',
  'GET /api/v1/proofs/:id',
  'GET /api/v1/proofs/:id/status',
  'GET /api/v1/proofs/:id/audit',
  'GET /api/v1/issuers/:id',
  'POST /api/v1/verify/file',
  'POST /api/v1/verify/hash',
  'POST /api/v1/verify/manifest',
  'GET /api/v1/pilot/charter',
  'GET /api/v1/pilot/results',
]);

test('public edge executable route matrix keeps every unapproved platform route pure 405', async () => {
  process.env.PUBLIC_EDGE = 'true';
  try {
    const routes = withPublicEdge(platformRoutes());
    const actualKeys = new Set(routes.map((route) => `${route.method} ${route.path}`));
    for (const key of expectedPublicEdgeRoutes) assert.ok(actualKeys.has(key), `missing ${key}`);
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (expectedPublicEdgeRoutes.has(key)) continue;
      const output = await route.handler(mockReq('203.0.113.10'), {}, {});
      assert.equal((output as { status: number }).status, 405, `${key} must be blocked`);
      assert.deepEqual((output as { body: unknown }).body, {
        error: 'method_not_allowed',
        reason: 'public_edge',
      });
    }
  } finally {
    delete process.env.PUBLIC_EDGE;
  }
});

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

    const resolutionOut = await find('POST', '/api/v1/commitments/:id/resolutions').handler(
      mockReq('198.51.100.1'),
      {},
      {},
    );
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
    for (const routeKey of complaintRouteKeys) {
      const [method, path] = routeKey.split(' ', 2);
      const out = await find(method, path).handler(mockReq('198.51.100.1'), {}, { id: 'cmp-1' });
      assert.equal((out as { status: number }).status, 405, `${routeKey} must be blocked`);
    }
    for (const [method, path] of [
      ['GET', '/api/v1/assistant/traces'],
      ['GET', '/api/v1/rewards/rules'],
      ['GET', '/api/v1/vault/documents'],
      ['GET', '/api/v1/vc/:id'],
      ['GET', '/api/v1/contributions/:id'],
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

test('withPublicEdge permits only the exact allowlist and fails unknown routes closed', async () => {
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
    const blockedRoutes = [
      ['POST', '/api/v1/contribute/evidence'],
      ['POST', '/api/v1/contribute/graph-edit'],
      ['GET', '/api/v1/review/queue'],
      ['POST', '/api/v1/review/:id/decide'],
      // Unknown routes fail closed even when a future route author forgets this module.
      ['POST', '/api/v1/new-write'],
      ['GET', '/api/v1/private-state'],
    ] as const;
    const routes = withPublicEdge([
      { method: 'GET', path: '/healthz', handler: spy }, // exempt → unchanged
      { method: 'POST', path: '/api/v1/verify/hash', handler: spy }, // wrapped
      ...blockedRoutes.map(([method, path]) => ({ method, path, handler: spy })),
    ]);
    const find = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.path === path)!;

    // Exempt operational route: handler reference-identical (not wrapped).
    assert.strictEqual(find('GET', '/healthz').handler, spy);

    // Every contribution/review pilot route is a pure 405 stub: no handler or upstream work.
    spyCalls = 0;
    for (const [method, path] of blockedRoutes) {
      const blocked = await find(method, path).handler(mockReq('198.51.100.2'), {}, {});
      assert.ok(
        blocked !== null && typeof blocked === 'object' && 'status' in blocked && 'body' in blocked,
      );
      assert.equal(blocked.status, 405);
      assert.deepEqual(blocked.body, {
        error: 'method_not_allowed',
        reason: 'public_edge',
      });
    }
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
      return new Response(JSON.stringify({ citizenId: 'citizen-123', identityLevel: 'verified' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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
    assert.equal(
      String(calls[0].input),
      'http://identity.internal/internal/identity/verify-session',
    );
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

test('complaint routes enforce citizen and staff sessions', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalComplaintsUrl = process.env.COMPLAINTS_INTERNAL_URL;
  const calls: string[] = [];

  process.env.INTERNAL_API_TOKEN = 'complaints-auth-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.COMPLAINTS_INTERNAL_URL = 'http://complaints.internal';
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ citizenId: 'citizen-123', identityLevel: 'verified' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const routes = platformRoutes();
    const citizenRoute = routes.find((r) => r.method === 'POST' && r.path === '/api/v1/complaints');
    const staffRoute = routes.find(
      (r) => r.method === 'GET' && r.path === '/api/v1/complaints/queue',
    );
    assert.ok(citizenRoute);
    assert.ok(staffRoute);

    const unauthenticated = await citizenRoute.handler(mockReq('198.51.100.20'), {}, {});
    assert.ok(
      unauthenticated &&
        typeof unauthenticated === 'object' &&
        'status' in unauthenticated &&
        'body' in unauthenticated,
    );
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(unauthenticated.body, { error: 'unauthenticated' });
    assert.equal(calls.length, 0);

    const denied = await staffRoute.handler(
      mockReq('198.51.100.20', { headers: { authorization: 'Bearer citizen-session' } }),
      undefined,
      {},
    );
    assert.ok(denied && typeof denied === 'object' && 'status' in denied && 'body' in denied);
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.body, { error: 'staff_required' });
    assert.deepEqual(calls, ['http://identity.internal/internal/identity/verify-session']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalComplaintsUrl === undefined) delete process.env.COMPLAINTS_INTERNAL_URL;
    else process.env.COMPLAINTS_INTERNAL_URL = originalComplaintsUrl;
  }
});

test('complaint proxy forwards trusted actor headers and ignores forged browser headers', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalComplaintsUrl = process.env.COMPLAINTS_INTERNAL_URL;
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];

  process.env.INTERNAL_API_TOKEN = 'complaints-proxy-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.COMPLAINTS_INTERNAL_URL = 'http://complaints.internal';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    if (String(input) === 'http://identity.internal/internal/identity/verify-session') {
      return new Response(
        JSON.stringify({ citizenId: 'trusted-citizen', identityLevel: 'staff' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const route = platformRoutes().find(
      (r) =>
        r.method === 'POST' &&
        r.path === '/api/v1/complaints/:id/information-requests/:requestId/respond',
    );
    assert.ok(route);
    const out = await route.handler(
      mockReq('198.51.100.21', {
        headers: {
          authorization: 'Bearer session-token',
          'x-polis-citizen': 'forged-citizen',
          'x-polis-identity-level': 'verified',
          'x-polis-internal-token': 'forged-token',
        },
      }),
      { response: 'received' },
      { id: 'cmp-123', requestId: 'request-456' },
    );

    assert.ok(out && typeof out === 'object' && 'status' in out);
    assert.equal(out.status, 202);
    assert.equal(
      String(calls[1].input),
      'http://complaints.internal/internal/complaints/cmp-123/information-requests/request-456/respond',
    );
    assert.equal(
      fetchHeader(calls[1].init?.headers, 'x-polis-internal-token'),
      'complaints-proxy-token',
    );
    assert.equal(fetchHeader(calls[1].init?.headers, 'x-polis-citizen'), 'trusted-citizen');
    assert.equal(fetchHeader(calls[1].init?.headers, 'x-polis-identity-level'), 'staff');
    assert.equal(JSON.stringify(calls[1].init?.headers).includes('forged'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalComplaintsUrl === undefined) delete process.env.COMPLAINTS_INTERNAL_URL;
    else process.env.COMPLAINTS_INTERNAL_URL = originalComplaintsUrl;
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
        r.method === 'POST' && r.path === '/api/v1/mandate-holders/:id/charter-signing-requests',
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

test('contribution writes require a healthy verified session and reject caller authority', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalContributionUrl = process.env.CONTRIBUTION_INTERNAL_URL;
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  process.env.INTERNAL_API_TOKEN = 'platform-contribution-test-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.CONTRIBUTION_INTERNAL_URL = 'http://contribution.internal';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    if (String(input).includes('/verify-session')) {
      const session = JSON.parse(String(init?.body)).sessionToken;
      if (session === 'invalid-session') {
        return new Response(JSON.stringify({ error: 'invalid_session' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (session === 'unavailable-session') {
        return new Response(JSON.stringify({ error: 'internal_error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (session === 'malformed-session') {
        return new Response(JSON.stringify({ citizenId: 'missing-level' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (session === 'throw-session') throw new Error('identity offline');
      return new Response(
        JSON.stringify({ citizenId: 'trusted-citizen', identityLevel: 'verified_resident' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ id: 'submission-1', status: 'pending' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const evidence = platformRoutes().find(
      (route) => route.method === 'POST' && route.path === '/api/v1/contribute/evidence',
    );
    const graphEdit = platformRoutes().find(
      (route) => route.method === 'POST' && route.path === '/api/v1/contribute/graph-edit',
    );
    assert.ok(evidence);
    assert.ok(graphEdit);

    const missing = await evidence.handler(mockReq('198.51.100.8'), { payload: {} }, {});
    assert.ok(missing && typeof missing === 'object' && 'status' in missing);
    assert.equal(missing.status, 401);
    assert.equal(calls.length, 0);

    for (const body of [
      { contributor: { identityLevel: 'staff' }, payload: {} },
      { contributorId: 'forged-contributor', payload: {} },
      { reviewerId: 'forged-reviewer', payload: {} },
      { reviewerRole: 'reviewer', payload: {} },
    ]) {
      const before: number = calls.length;
      const denied: unknown = await evidence.handler(
        mockReq('198.51.100.8', { headers: { authorization: 'Bearer trusted-session' } }),
        body,
        {},
      );
      assert.ok(denied && typeof denied === 'object' && 'status' in denied);
      assert.equal(denied.status, 400);
      assert.equal(calls.length, before);
    }

    const forgedHeaders: Array<Record<string, string>> = [
      { 'x-polis-citizen': 'forged-citizen' },
      { 'x-polis-identity-level': 'staff' },
      { 'x-polis-internal-token': 'forged-token' },
    ];

    for (const header of forgedHeaders) {
      const before: number = calls.length;
      const denied: unknown = await graphEdit.handler(
        mockReq('198.51.100.8', {
          headers: { authorization: 'Bearer trusted-session', ...header },
        }),
        { payload: {} },
        {},
      );
      assert.ok(denied && typeof denied === 'object' && 'status' in denied);
      assert.equal(denied.status, 400);
      assert.equal(calls.length, before);
    }

    for (const [session, status] of [
      ['invalid-session', 401],
      ['unavailable-session', 503],
      ['malformed-session', 503],
      ['throw-session', 503],
    ] as const) {
      const before: number = calls.length;
      const denied: unknown = await evidence.handler(
        mockReq('198.51.100.8', { headers: { authorization: `Bearer ${session}` } }),
        { payload: { text: 'evidence' } },
        {},
      );
      assert.ok(denied && typeof denied === 'object' && 'status' in denied);
      assert.equal(denied.status, status);
      assert.equal(calls.length, before + 1, 'identity failure must not call contribution-service');
    }

    const payload = {
      payload: {
        text: 'trusted evidence',
        claimType: 'other',
        subjectType: 'claim',
        subjectId: 'claim-1',
        confidence: 0.8,
      },
    };
    const accepted = await evidence.handler(
      mockReq('198.51.100.8', { headers: { authorization: 'Bearer trusted-session' } }),
      payload,
      {},
    );
    assert.ok(accepted && typeof accepted === 'object' && 'status' in accepted);
    assert.equal(accepted.status, 201);
    const upstream = calls.at(-1);
    assert.ok(upstream);
    assert.equal(String(upstream.input), 'http://contribution.internal/api/v1/contribute/evidence');
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-citizen'), 'trusted-citizen');
    assert.equal(
      fetchHeader(upstream.init?.headers, 'x-polis-identity-level'),
      'verified_resident',
    );
    assert.equal(
      fetchHeader(upstream.init?.headers, 'x-polis-internal-token'),
      'platform-contribution-test-token',
    );
    assert.deepEqual(JSON.parse(String(upstream.init?.body)), payload);
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

test('review routes reject forged authority and forward only a verified distinct staff actor', async () => {
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
          citizenId: session === 'staff-session' ? 'staff-reviewer' : 'citizen-1',
          identityLevel: session === 'staff-session' ? 'staff' : 'verified_resident',
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
      (route) => route.method === 'GET' && route.path === '/api/v1/review/queue',
    );
    const decide = platformRoutes().find(
      (route) => route.method === 'POST' && route.path === '/api/v1/review/:id/decide',
    );
    assert.ok(queue);
    assert.ok(decide);

    const unauthenticated = await queue.handler(mockReq('198.51.100.8'), {}, {});
    assert.ok(
      unauthenticated && typeof unauthenticated === 'object' && 'status' in unauthenticated,
    );
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls.length, 0);

    const forbidden = await queue.handler(
      mockReq('198.51.100.8', { headers: { authorization: 'Bearer citizen-session' } }),
      {},
      {},
    );
    assert.ok(forbidden && typeof forbidden === 'object' && 'status' in forbidden);
    assert.equal(forbidden.status, 403);

    for (const body of [
      { decision: 'approve', reviewerId: 'forged-reviewer' },
      { decision: 'approve', reviewerRole: 'reviewer' },
    ]) {
      const before: number = calls.length;
      const denied: unknown = await decide.handler(
        mockReq('198.51.100.8', { headers: { authorization: 'Bearer staff-session' } }),
        body,
        { id: 'submission-1' },
      );
      assert.ok(denied && typeof denied === 'object' && 'status' in denied);
      assert.equal(denied.status, 400);
      assert.equal(calls.length, before);
    }

    const beforeForgedHeader = calls.length;
    const forgedHeader = await decide.handler(
      mockReq('198.51.100.8', {
        headers: {
          authorization: 'Bearer staff-session',
          'x-polis-citizen': 'forged-reviewer',
        },
      }),
      { decision: 'approve' },
      { id: 'submission-1' },
    );
    assert.ok(forgedHeader && typeof forgedHeader === 'object' && 'status' in forgedHeader);
    assert.equal(forgedHeader.status, 400);
    assert.equal(calls.length, beforeForgedHeader);

    const reviewed = await decide.handler(
      mockReq('198.51.100.8', { headers: { authorization: 'Bearer staff-session' } }),
      { decision: 'approve', notes: 'checked' },
      { id: 'submission-1' },
    );
    assert.ok(reviewed && typeof reviewed === 'object' && 'status' in reviewed);
    assert.equal(reviewed.status, 201);
    const upstream = calls.at(-1);
    assert.ok(upstream);
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-citizen'), 'staff-reviewer');
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

test('assistant administration routes require staff and forward trusted actor context', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalAiUrl = process.env.AI_INTERNAL_URL;
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  process.env.INTERNAL_API_TOKEN = 'platform-assistant-test-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.AI_INTERNAL_URL = 'http://ai.internal';
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
    return new Response(JSON.stringify({ ok: true, path: String(input) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const routes = platformRoutes();
    const protectedRoutes: Array<{
      method: string;
      path: string;
      params: Record<string, string>;
      upstream: string;
    }> = [
      {
        method: 'GET',
        path: '/api/v1/assistant/traces',
        params: {},
        upstream: '/internal/ai/traces',
      },
      {
        method: 'GET',
        path: '/api/v1/assistant/traces/:id',
        params: { id: 'trace-1' },
        upstream: '/internal/ai/traces/trace-1',
      },
      {
        method: 'GET',
        path: '/api/v1/assistant/outputs/:id',
        params: { id: 'output-1' },
        upstream: '/internal/ai/outputs/output-1',
      },
      {
        method: 'POST',
        path: '/api/v1/assistant/outputs/:id/review',
        params: { id: 'output-1' },
        upstream: '/internal/ai/outputs/output-1/review',
      },
    ];

    for (const routeInfo of protectedRoutes) {
      const route = routes.find((r) => r.method === routeInfo.method && r.path === routeInfo.path);
      assert.ok(route);
      const unauthenticated = await route.handler(mockReq('198.51.100.9'), {}, routeInfo.params);
      assert.ok(
        unauthenticated && typeof unauthenticated === 'object' && 'status' in unauthenticated,
      );
      assert.equal(unauthenticated.status, 401);

      const forbidden = await route.handler(
        mockReq('198.51.100.9', { headers: { authorization: 'Bearer citizen-session' } }),
        {},
        routeInfo.params,
      );
      assert.ok(forbidden && typeof forbidden === 'object' && 'status' in forbidden);
      assert.equal(forbidden.status, 403);
    }

    for (const routeInfo of protectedRoutes.filter((r) => r.method === 'GET')) {
      const route = routes.find((r) => r.method === routeInfo.method && r.path === routeInfo.path);
      assert.ok(route);
      const before = calls.length;
      const out = await route.handler(
        mockReq('198.51.100.9', { headers: { authorization: 'Bearer staff-session' } }),
        {},
        routeInfo.params,
      );
      assert.ok(out && typeof out === 'object' && 'status' in out);
      assert.equal(out.status, 200);
      const upstream = calls.slice(before).at(-1);
      assert.ok(upstream);
      assert.equal(String(upstream.input), 'http://ai.internal' + routeInfo.upstream);
      assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-citizen'), 'staff-1');
      assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-identity-level'), 'staff');
    }

    const review = routes.find(
      (r) => r.method === 'POST' && r.path === '/api/v1/assistant/outputs/:id/review',
    );
    assert.ok(review);
    const before = calls.length;
    const reviewed = await review.handler(
      mockReq('198.51.100.9', { headers: { authorization: 'Bearer staff-session' } }),
      {
        decision: 'approve',
        notes: 'checked',
        reviewerId: 'forged-reviewer',
        reviewerRole: 'reviewer',
      },
      { id: 'output-1' },
    );
    assert.ok(reviewed && typeof reviewed === 'object' && 'status' in reviewed);
    assert.equal(reviewed.status, 200);
    const upstream = calls.slice(before).at(-1);
    assert.ok(upstream);
    assert.equal(String(upstream.input), 'http://ai.internal/internal/ai/outputs/output-1/review');
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-citizen'), 'staff-1');
    assert.equal(fetchHeader(upstream.init?.headers, 'x-polis-identity-level'), 'staff');
    assert.deepEqual(JSON.parse(String(upstream.init?.body)), {
      reviewerId: 'staff-1',
      decision: 'approve',
      notes: 'checked',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalAiUrl === undefined) delete process.env.AI_INTERNAL_URL;
    else process.env.AI_INTERNAL_URL = originalAiUrl;
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

test('internal BFF calls use a validated timeout and return safe gateway errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalGraphUrl = process.env.GRAPH_INTERNAL_URL;
  const originalTimeout = process.env.INTERNAL_FETCH_TIMEOUT_MS;
  const internalUrl = 'http://graph.secret.internal';
  process.env.INTERNAL_API_TOKEN = 'timeout-secret-token';
  process.env.GRAPH_INTERNAL_URL = internalUrl;
  process.env.INTERNAL_FETCH_TIMEOUT_MS = '17';

  try {
    assert.equal(parseInternalFetchTimeoutMs(), 17);
    assert.equal(parseInternalFetchTimeoutMs(''), 5_000);
    assert.throws(() => parseInternalFetchTimeoutMs('invalid'), /INTERNAL_FETCH_TIMEOUT_MS/);
    assert.throws(() => parseInternalFetchTimeoutMs('0'), /INTERNAL_FETCH_TIMEOUT_MS/);

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      assert.ok(init?.signal);
      throw new FetchTimeoutError(17);
    }) as typeof fetch;
    const route = platformRoutes().find(
      (candidate) => candidate.method === 'GET' && candidate.path === '/api/v1/jurisdictions',
    )!;
    const timedOut = await route.handler(
      mockReq('198.51.100.10', { method: 'GET', url: '/api/v1/jurisdictions' }),
      undefined,
      {},
    );
    assert.ok(
      timedOut && typeof timedOut === 'object' && 'status' in timedOut && 'body' in timedOut,
    );
    assert.equal(timedOut.status, 504);
    assert.deepEqual(timedOut.body, { error: 'upstream_timeout' });
    assert.equal(JSON.stringify(timedOut).includes(internalUrl), false);
    assert.equal(JSON.stringify(timedOut).includes('timeout-secret-token'), false);

    globalThis.fetch = (async () => {
      throw new Error(`failed to reach ${internalUrl} with timeout-secret-token`);
    }) as typeof fetch;
    const failed = await route.handler(
      mockReq('198.51.100.10', { method: 'GET', url: '/api/v1/jurisdictions' }),
      undefined,
      {},
    );
    assert.ok(failed && typeof failed === 'object' && 'status' in failed && 'body' in failed);
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.body, { error: 'bad_gateway' });
    assert.equal(JSON.stringify(failed).includes(internalUrl), false);
    assert.equal(JSON.stringify(failed).includes('timeout-secret-token'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalGraphUrl === undefined) delete process.env.GRAPH_INTERNAL_URL;
    else process.env.GRAPH_INTERNAL_URL = originalGraphUrl;
    if (originalTimeout === undefined) delete process.env.INTERNAL_FETCH_TIMEOUT_MS;
    else process.env.INTERNAL_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

test('complaint proxy returns safe 502 and 504 errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INTERNAL_API_TOKEN;
  const originalIdentityUrl = process.env.IDENTITY_INTERNAL_URL;
  const originalComplaintsUrl = process.env.COMPLAINTS_INTERNAL_URL;
  const secretUrl = 'http://complaints.secret.internal';

  process.env.INTERNAL_API_TOKEN = 'complaints-gateway-token';
  process.env.IDENTITY_INTERNAL_URL = 'http://identity.internal';
  process.env.COMPLAINTS_INTERNAL_URL = secretUrl;

  try {
    const route = platformRoutes().find(
      (r) => r.method === 'GET' && r.path === '/api/v1/complaints/mine',
    );
    assert.ok(route);

    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes('/verify-session')) {
        return new Response(
          JSON.stringify({ citizenId: 'citizen-123', identityLevel: 'verified' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new FetchTimeoutError(5_000);
    }) as typeof fetch;
    const timedOut = await route.handler(
      mockReq('198.51.100.22', { headers: { authorization: 'Bearer session' } }),
      undefined,
      {},
    );
    assert.ok(
      timedOut && typeof timedOut === 'object' && 'status' in timedOut && 'body' in timedOut,
    );
    assert.equal(timedOut.status, 504);
    assert.deepEqual(timedOut.body, { error: 'upstream_timeout' });
    assert.equal(JSON.stringify(timedOut).includes(secretUrl), false);

    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).includes('/verify-session')) {
        return new Response(
          JSON.stringify({ citizenId: 'citizen-123', identityLevel: 'verified' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      throw new Error(`failed to reach ${secretUrl}`);
    }) as typeof fetch;
    const failed = await route.handler(
      mockReq('198.51.100.22', { headers: { authorization: 'Bearer session' } }),
      undefined,
      {},
    );
    assert.ok(failed && typeof failed === 'object' && 'status' in failed && 'body' in failed);
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.body, { error: 'bad_gateway' });
    assert.equal(JSON.stringify(failed).includes(secretUrl), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
    if (originalIdentityUrl === undefined) delete process.env.IDENTITY_INTERNAL_URL;
    else process.env.IDENTITY_INTERNAL_URL = originalIdentityUrl;
    if (originalComplaintsUrl === undefined) delete process.env.COMPLAINTS_INTERNAL_URL;
    else process.env.COMPLAINTS_INTERNAL_URL = originalComplaintsUrl;
  }
});

test('platform readiness checks the database and every pilot upstream with internal headers', async () => {
  const originalToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'readiness-internal-token';
  const urls: string[] = [];
  let checkedDatabase: { url: string | undefined; timeoutMs: number } | undefined;

  try {
    const status = await checkPlatformReadiness({
      env: {
        DEPLOYMENT_PROFILE: 'pilot',
        DATABASE_URL: 'postgres://db.internal/polis',
        INTERNAL_FETCH_TIMEOUT_MS: '321',
        GRAPH_INTERNAL_URL: 'http://graph.internal',
        AUDIT_INTERNAL_URL: 'http://audit.internal',
        PROOF_INTERNAL_URL: 'http://proof.internal',
        POLIS_INTERNAL_URL: 'http://polis.internal',
        COMPLAINTS_INTERNAL_URL: 'http://complaints.internal',
      },
      databaseCheck: async (url, timeoutMs) => {
        checkedDatabase = { url, timeoutMs };
      },
      timedFetch: async (input, init, timeoutMs) => {
        urls.push(String(input));
        assert.equal(timeoutMs, 321);
        assert.equal(
          fetchHeader(init?.headers, 'x-polis-internal-token'),
          'readiness-internal-token',
        );
        return new Response(null, { status: 200 });
      },
    });

    assert.deepEqual(checkedDatabase, {
      url: 'postgres://db.internal/polis',
      timeoutMs: 321,
    });
    assert.deepEqual(urls, [
      'http://graph.internal/readyz',
      'http://audit.internal/readyz',
      'http://proof.internal/readyz',
      'http://polis.internal/readyz',
      'http://complaints.internal/readyz',
    ]);
    assert.deepEqual(status, { ready: true });
  } finally {
    if (originalToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = originalToken;
  }
});

test('platform readiness fails with only the safe dependency label', async () => {
  const env = {
    PUBLIC_EDGE: 'true',
    DATABASE_URL: 'postgres://alice:secret@db.internal/polis',
    GRAPH_INTERNAL_URL: 'http://graph.internal',
    AUDIT_INTERNAL_URL: 'http://audit.internal',
    PROOF_INTERNAL_URL: 'http://proof.internal',
    POLIS_INTERNAL_URL: 'http://polis.internal',
  };
  const databaseFailure = await checkPlatformReadiness({
    env,
    databaseCheck: async () => {
      throw new Error('postgres://alice:secret@db.internal/polis');
    },
  });
  assert.deepEqual(databaseFailure, { ready: false, dependency: 'database' });

  const failures = [
    ['graph.internal', 'governance_graph'],
    ['audit.internal', 'audit'],
    ['proof.internal', 'proof'],
    ['polis.internal', 'polis'],
  ] as const;
  for (const [failedHost, dependency] of failures) {
    const status = await checkPlatformReadiness({
      env,
      databaseCheck: async () => undefined,
      readinessHeaders: () => ({ 'x-polis-internal-token': 'token' }),
      timedFetch: async (input) =>
        new Response(null, { status: String(input).includes(failedHost) ? 503 : 200 }),
    });
    assert.deepEqual(status, { ready: false, dependency });
    assert.equal(JSON.stringify(status).includes('.internal'), false);
    assert.equal(JSON.stringify(status).includes('secret'), false);
  }
});

test('platform readiness checks complaints only outside PUBLIC_EDGE', async () => {
  const privateUrls: string[] = [];
  const privateStatus = await checkPlatformReadiness({
    env: {
      DATABASE_URL: 'postgres://db.internal/polis',
      GRAPH_INTERNAL_URL: 'http://graph.internal',
      AUDIT_INTERNAL_URL: 'http://audit.internal',
      PROOF_INTERNAL_URL: 'http://proof.internal',
      POLIS_INTERNAL_URL: 'http://polis.internal',
      COMPLAINTS_INTERNAL_URL: 'http://complaints.internal',
      DEPLOYMENT_PROFILE: 'dev',
    },
    databaseCheck: async () => undefined,
    readinessHeaders: () => ({ 'x-polis-internal-token': 'token' }),
    timedFetch: async (input) => {
      privateUrls.push(String(input));
      return new Response(null, {
        status: String(input) === 'http://complaints.internal/readyz' ? 503 : 200,
      });
    },
  });
  assert.deepEqual(privateUrls, ['http://complaints.internal/readyz']);
  assert.deepEqual(privateStatus, { ready: false, dependency: 'complaints' });

  const publicUrls: string[] = [];
  const publicStatus = await checkPlatformReadiness({
    env: {
      PUBLIC_EDGE: 'true',
      DATABASE_URL: 'postgres://db.internal/polis',
      GRAPH_INTERNAL_URL: 'http://graph.internal',
      AUDIT_INTERNAL_URL: 'http://audit.internal',
      PROOF_INTERNAL_URL: 'http://proof.internal',
      POLIS_INTERNAL_URL: 'http://polis.internal',
      COMPLAINTS_INTERNAL_URL: 'http://complaints.internal',
    },
    databaseCheck: async () => undefined,
    readinessHeaders: () => ({ 'x-polis-internal-token': 'token' }),
    timedFetch: async (input) => {
      publicUrls.push(String(input));
      return new Response(null, {
        status: String(input) === 'http://complaints.internal/readyz' ? 503 : 200,
      });
    },
  });
  assert.deepEqual(publicUrls, [
    'http://graph.internal/readyz',
    'http://audit.internal/readyz',
    'http://proof.internal/readyz',
    'http://polis.internal/readyz',
  ]);
  assert.deepEqual(publicStatus, { ready: true });
});

test('pilot migration failure propagates before service startup', async () => {
  const migrationError = new Error('migration failed');
  let warnings = 0;
  await assert.rejects(
    runPlatformMigrations({
      env: { DEPLOYMENT_PROFILE: 'pilot' },
      migrate: async () => {
        throw migrationError;
      },
      warn: () => {
        warnings += 1;
      },
    }),
    (error: unknown) => error === migrationError,
  );
  assert.equal(warnings, 0);
});

test('dev migration failure preserves warning-and-start tolerance', async () => {
  const warnings: string[] = [];
  await runPlatformMigrations({
    env: { DEPLOYMENT_PROFILE: 'dev' },
    migrate: async () => {
      throw new Error('development database unavailable');
    },
    warn: (message) => {
      warnings.push(message);
    },
  });
  assert.equal(warnings.length, 1);
  assert.deepEqual(JSON.parse(warnings[0]!), {
    service: 'platform-api',
    stage: 'db-migrate',
    warning: 'development database unavailable',
  });
});

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
});

test('withPublicEdge is a no-op unless PUBLIC_EDGE=true (reference identity)', () => {
  const base = platformRoutes();
  assert.strictEqual(withPublicEdge(base), base);
});

const mockReq = (ip: string): IncomingMessage =>
  ({ socket: { remoteAddress: ip } }) as unknown as IncomingMessage;

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

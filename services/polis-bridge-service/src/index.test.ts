import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { databaseReadiness, internalFetchTimeoutMs, polisRoutes } from './index.js';
import { StubPolisClient } from './polis-client.js';

async function withInternalToken(token: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = token;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
}

async function withBridgeServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = startService(
    'polis-bridge-service',
    0,
    polisRoutes({} as never, new StubPolisClient()),
  );
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('polis-bridge-service readiness reports only database failures', async () => {
  assert.deepEqual(await databaseReadiness(async () => undefined), { ready: true });
  assert.deepEqual(
    await databaseReadiness(async () => {
      throw new Error('postgres://credentials@db.internal/polis');
    }),
    { ready: false, dependency: 'database' },
  );
});

test('polis-bridge-service validates the internal fetch timeout', () => {
  assert.equal(internalFetchTimeoutMs(undefined), 5_000);
  assert.equal(internalFetchTimeoutMs('1'), 1);
  assert.equal(internalFetchTimeoutMs('15000'), 15_000);
  assert.throws(() => internalFetchTimeoutMs('0'), /INTERNAL_FETCH_TIMEOUT_MS/);
  assert.throws(() => internalFetchTimeoutMs('300001'), /INTERNAL_FETCH_TIMEOUT_MS/);
  assert.throws(() => internalFetchTimeoutMs('not-a-number'), /INTERNAL_FETCH_TIMEOUT_MS/);
});

test('polis-bridge-service bounds best-effort audit emission', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'bridge-test-token';
  const originalFetch = globalThis.fetch;
  const outboundSignals: AbortSignal[] = [];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    assert.ok(init?.signal, 'missing deadline for audit emission');
    outboundSignals.push(init.signal as AbortSignal);
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }) as typeof globalThis.fetch;
  try {
    const db = {
      select: () => ({
        from: () => ({ where: () => [{ id: 'issue-1' }] }),
      }),
      insert: () => ({
        values: () => ({
          returning: () => [
            {
              id: 'conversation-1',
              externalPolisId: 'polis-1',
              issueId: 'issue-1',
              title: '',
              framingQuestion: '',
              participationMode: 'open',
              status: 'draft',
              reportUrl: null,
              createdAt: new Date('2026-08-03T00:00:00.000Z'),
              closedAt: null,
            },
          ],
        }),
      }),
    };
    const route = polisRoutes(db as never, new StubPolisClient()).find(
      (item) => item.path === '/internal/polis/conversations',
    )!;
    await route.handler({} as never, { issueId: 'issue-1' }, {});
    assert.equal(outboundSignals.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('polis-bridge-service exposes §13 issues + conversation + internal sync routes', () => {
  const paths = polisRoutes({} as never, new StubPolisClient()).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'GET /api/v1/issues',
    'GET /api/v1/issues/:id',
    'GET /api/v1/processes/:id/issues',
    'GET /api/v1/issues/:id/conversation',
    'POST /internal/polis/conversations',
    'POST /internal/polis/conversations/:id/sync',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

test('polis-bridge-service rejects unauthenticated internal HTTP requests', async () => {
  await withInternalToken('bridge-test-token', async () => {
    await withBridgeServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/polis/conversations`, {
        method: 'POST',
        body: JSON.stringify({ issueId: 'issue-1' }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: 'internal_auth_required',
        service: 'polis-bridge-service',
      });
    });
  });
});

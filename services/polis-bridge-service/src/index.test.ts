import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { polisRoutes } from './index.js';
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

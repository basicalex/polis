import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService, type Route } from '@polis/service-runtime';
import { rewardRoutes } from './index.js';

const INTERNAL_PATH = '/internal/rewards/eligibility';
const INTERNAL_TOKEN = 'rewards-test-token';

async function withRewardsServer(
  routes: Route[],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  const server = startService('rewards-service', 0, routes);
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
}

function postEligibility(baseUrl: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['x-polis-internal-token'] = token;
  return fetch(baseUrl + INTERNAL_PATH, {
    method: 'POST',
    headers,
    body: '{}',
  });
}

test('rewards-service exposes operational, public, and internal routes', () => {
  const paths = rewardRoutes({} as never).map((route) => `${route.method} ${route.path}`);
  for (const path of [
    'GET /healthz',
    'GET /readyz',
    'GET /metrics',
    'GET /version',
    'POST /internal/rewards/eligibility',
    'GET /api/v1/rewards/rules',
    'GET /api/v1/rewards/public-ledger',
    'GET /internal/rewards/eligibility/:submissionId',
    'GET /internal/rewards/payouts/export',
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test('rewards-service guards internal routes while operational routes stay open', async () => {
  const routes = rewardRoutes({} as never);
  const eligibilityRoute = routes.find(
    (route) => route.method === 'POST' && route.path === INTERNAL_PATH,
  );
  assert.ok(eligibilityRoute);

  const originalHandler = eligibilityRoute.handler;
  let handlerCalls = 0;
  eligibilityRoute.handler = (...args) => {
    handlerCalls += 1;
    return originalHandler(...args);
  };

  await withRewardsServer(routes, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);

    const missing = await postEligibility(baseUrl);
    assert.equal(missing.status, 401);
    assert.equal(handlerCalls, 0);

    const wrong = await postEligibility(baseUrl, 'wrong-token');
    assert.equal(wrong.status, 401);
    assert.equal(handlerCalls, 0);

    const correct = await postEligibility(baseUrl, INTERNAL_TOKEN);
    assert.notEqual(correct.status, 401);
    assert.equal(handlerCalls, 1);
  });
});

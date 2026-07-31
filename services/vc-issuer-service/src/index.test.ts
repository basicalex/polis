import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService, type Route } from '@polis/service-runtime';
import { vcRoutes } from './index.js';

const INTERNAL_PATH = '/internal/vc/issue';
const INTERNAL_TOKEN = 'vc-issuer-test-token';

async function withVcIssuerServer(
  routes: Route[],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  const server = startService('vc-issuer-service', 0, routes);
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

function postIssue(baseUrl: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['x-polis-internal-token'] = token;
  return fetch(baseUrl + INTERNAL_PATH, {
    method: 'POST',
    headers,
    body: '{}',
  });
}

test('vc-issuer-service exposes operational and issuance routes', () => {
  const paths = vcRoutes({} as never).map((route) => `${route.method} ${route.path}`);
  for (const path of [
    'GET /healthz',
    'GET /readyz',
    'GET /metrics',
    'GET /version',
    'POST /internal/vc/issue',
    'GET /internal/vc/:id',
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test('vc-issuer-service guards internal routes while operational routes stay open', async () => {
  const routes = vcRoutes({} as never);
  const issueRoute = routes.find(
    (route) => route.method === 'POST' && route.path === INTERNAL_PATH,
  );
  assert.ok(issueRoute);

  const originalHandler = issueRoute.handler;
  let handlerCalls = 0;
  issueRoute.handler = (...args) => {
    handlerCalls += 1;
    return originalHandler(...args);
  };

  await withVcIssuerServer(routes, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);

    const missing = await postIssue(baseUrl);
    assert.equal(missing.status, 401);
    assert.equal(handlerCalls, 0);

    const wrong = await postIssue(baseUrl, 'wrong-token');
    assert.equal(wrong.status, 401);
    assert.equal(handlerCalls, 0);

    const correct = await postIssue(baseUrl, INTERNAL_TOKEN);
    assert.notEqual(correct.status, 401);
    assert.equal(handlerCalls, 1);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService, type HttpResult, type Route } from '@polis/service-runtime';
import { vaultRoutes } from './index.js';

const INTERNAL_PATH = '/internal/vault/verify';
const INTERNAL_TOKEN = 'vault-test-token';

async function withVaultServer(
  routes: Route[],
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  const server = startService('citizen-vault-service', 0, routes);
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

function postVerify(baseUrl: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['x-polis-internal-token'] = token;
  return fetch(baseUrl + INTERNAL_PATH, {
    method: 'POST',
    headers,
    body: '{}',
  });
}

test('citizen-vault-service exposes operational and vault routes', () => {
  const paths = vaultRoutes({} as never).map((route) => `${route.method} ${route.path}`);
  for (const path of [
    'GET /healthz',
    'GET /readyz',
    'GET /metrics',
    'GET /version',
    'POST /internal/vault/documents',
    'GET /internal/vault/documents',
    'POST /internal/vault/grants',
    'DELETE /internal/vault/grants/:id',
    'GET /internal/vault/access-events',
    'POST /internal/vault/verify',
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test('citizen-vault-service guards internal routes while operational routes stay open', async () => {
  const routes = vaultRoutes({} as never);
  const verifyRoute = routes.find(
    (route) => route.method === 'POST' && route.path === INTERNAL_PATH,
  );
  assert.ok(verifyRoute);

  const originalHandler = verifyRoute.handler;
  let handlerCalls = 0;
  verifyRoute.handler = (...args) => {
    handlerCalls += 1;
    return originalHandler(...args);
  };

  await withVaultServer(routes, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);

    const missing = await postVerify(baseUrl);
    assert.equal(missing.status, 401);
    assert.equal(handlerCalls, 0);

    const wrong = await postVerify(baseUrl, 'wrong-token');
    assert.equal(wrong.status, 401);
    assert.equal(handlerCalls, 0);

    const correct = await postVerify(baseUrl, INTERNAL_TOKEN);
    assert.notEqual(correct.status, 401);
    assert.equal(handlerCalls, 1);
  });
});

function vaultDbForScope(scope: 'proof_only' | 'metadata'): unknown {
  const grant = {
    id: 'grant-1',
    grantee: { type: 'institution', id: 'grantee-1' },
    scope,
    status: 'active',
    startsAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    vaultDocumentId: 'vault-document-1',
  };
  const documentProjection = {
    vd: {
      id: 'vault-document-1',
      proofManifestId: 'proof-1',
      documentId: 'document-1',
      content: 'must-not-leak',
      url: 'https://example.invalid/private',
      ocrText: 'must-not-leak',
    },
    manifestHash: 'hash-1',
    issuerName: 'Example issuer',
    registryStatus: 'active',
  };
  const selections = [[grant], [documentProjection]];

  return {
    select: () => {
      const rows = selections.shift() ?? [];
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.leftJoin = () => chain;
      chain.where = () => chain;
      chain.limit = async () => rows;
      return chain;
    },
    insert: () => ({ values: async () => undefined }),
  };
}

for (const scope of ['proof_only', 'metadata'] as const) {
  test(`vault ${scope} verification never returns document content fields`, async () => {
    const route = vaultRoutes(vaultDbForScope(scope) as never).find(
      (candidate) => candidate.method === 'POST' && candidate.path === INTERNAL_PATH,
    );
    assert.ok(route);

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    try {
      const output = (await route.handler(
        {} as never,
        { grantId: 'grant-1' },
        {},
      )) as HttpResult;
      assert.equal(output.status, 200);
      assert.deepEqual(output.body, {
        verdict: 'valid',
        proofManifestId: 'proof-1',
        manifestHash: 'hash-1',
        issuerName: 'Example issuer',
      });
      for (const field of [
        'content',
        'bytes',
        'url',
        'ocrText',
        'documentId',
        'document',
        'manifest',
      ]) {
        assert.ok(!(field in (output.body as Record<string, unknown>)), `leaked ${field}`);
      }
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}

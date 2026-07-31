import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { identityRoutes } from './index.js';


async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'identity-test-token';
  const server = startService('citizen-identity-service', 0, identityRoutes({} as never));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function stubIdentityDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: async () => undefined,
    }),
  };
}
// Handlers are lazy closures, so building the table never touches the DB.
test('citizen-identity-service exposes §21 magic-link + M10 OIDC routes', () => {
  const paths = identityRoutes({} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/identity/magic-link',
    'POST /internal/identity/exchange',
    'POST /internal/identity/verify-session',
    'GET /internal/identity/citizens/:id',
    'GET /internal/identity/dev-tokens',
    'GET /internal/identity/authorize',
    'POST /internal/identity/callback',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});

test('identity internal routes reject unauthenticated real HTTP requests', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/identity/dev-tokens`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'internal_auth_required',
      service: 'citizen-identity-service',
    });
  });
});

test('magic-link audit request sends internal authentication', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousAuditUrl = process.env.AUDIT_INTERNAL_URL;
  const previousFetch = globalThis.fetch;
  const seen: { url?: string; headers?: HeadersInit } = {};
  process.env.INTERNAL_API_TOKEN = 'audit-test-token';
  process.env.AUDIT_INTERNAL_URL = 'http://audit.test';
  globalThis.fetch = (async (input, init) => {
    seen.url = String(input);
    seen.headers = init?.headers;
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    const route = identityRoutes(stubIdentityDb() as never).find(
      (candidate) => candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
    );
    assert.ok(route);
    const out = (await route.handler(
      { url: '/internal/identity/magic-link' } as never,
      { email: 'Ada@Test.Example' },
      {},
    )) as { status: number; body: unknown };
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { sent: true });
    assert.equal(seen.url, 'http://audit.test/internal/audit/events');
    assert.deepEqual(seen.headers, {
      'content-type': 'application/json',
      'x-polis-internal-token': 'audit-test-token',
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
    if (previousAuditUrl === undefined) delete process.env.AUDIT_INTERNAL_URL;
    else process.env.AUDIT_INTERNAL_URL = previousAuditUrl;
  }
});

test('missing internal token stays inside best-effort audit warning path', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const warnings: string[] = [];
  delete process.env.INTERNAL_API_TOKEN;
  globalThis.fetch = (async () => {
    throw new Error('audit fetch should not run without internal auth');
  }) as typeof fetch;
  console.error = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    const route = identityRoutes(stubIdentityDb() as never).find(
      (candidate) => candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
    );
    assert.ok(route);
    const out = (await route.handler(
      { url: '/internal/identity/magic-link' } as never,
      { email: 'ada@test.example' },
      {},
    )) as { status: number; body: unknown };
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { sent: true });
    assert.equal(warnings.length, 1);
    assert.deepEqual(JSON.parse(warnings[0]), {
      service: 'citizen-identity-service',
      stage: 'audit-emit',
      warning: 'INTERNAL_API_TOKEN is required',
    });
  } finally {
    console.error = previousError;
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { identityRoutes } from './index.js';

const TEST_HMAC_KEY = 'identity-test-hmac-key-with-at-least-32-bytes';
const execFileAsync = promisify(execFile);

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function runDirectStartup(
  key: string | undefined,
): Promise<{ error: Error | null; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0' };
  if (key === undefined) delete env.IDENTITY_HMAC_KEY;
  else env.IDENTITY_HMAC_KEY = key;
  try {
    const { stderr } = await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL('./index.js', import.meta.url))],
      { encoding: 'utf8', env, timeout: 3_000 },
    );
    return { error: null, stderr };
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    return { error: failure, stderr: failure.stderr ?? '' };
  }
}

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
    const closed = once(server, 'close');
    server.close();
    await closed;
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
  const previousHmacKey = process.env.IDENTITY_HMAC_KEY;
  const previousFetch = globalThis.fetch;
  const seen: { url?: string; headers?: HeadersInit; body?: string } = {};
  process.env.INTERNAL_API_TOKEN = 'audit-test-token';
  process.env.AUDIT_INTERNAL_URL = 'http://audit.test';
  process.env.IDENTITY_HMAC_KEY = TEST_HMAC_KEY;
  globalThis.fetch = (async (input, init) => {
    seen.url = String(input);
    seen.headers = init?.headers;
    seen.body = String(init?.body);
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    const route = identityRoutes(stubIdentityDb() as never).find(
      (candidate) =>
        candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
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
    assert.ok(seen.body);
    const audit = JSON.parse(seen.body);
    assert.equal(audit.visibility, 'restricted');
    assert.equal(audit.target.type, 'citizen');
    assert.notEqual(audit.target.id, 'ada@test.example');
    assert.doesNotMatch(seen.body, /ada@test\.example/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
    if (previousAuditUrl === undefined) delete process.env.AUDIT_INTERNAL_URL;
    else process.env.AUDIT_INTERNAL_URL = previousAuditUrl;
    if (previousHmacKey === undefined) delete process.env.IDENTITY_HMAC_KEY;
    else process.env.IDENTITY_HMAC_KEY = previousHmacKey;
  }
});

test('missing internal token stays inside best-effort audit warning path', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousHmacKey = process.env.IDENTITY_HMAC_KEY;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const warnings: string[] = [];
  delete process.env.INTERNAL_API_TOKEN;
  process.env.IDENTITY_HMAC_KEY = TEST_HMAC_KEY;
  globalThis.fetch = (async () => {
    throw new Error('audit fetch should not run without internal auth');
  }) as typeof fetch;
  console.error = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    const route = identityRoutes(stubIdentityDb() as never).find(
      (candidate) =>
        candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
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
    if (previousHmacKey === undefined) delete process.env.IDENTITY_HMAC_KEY;
    else process.env.IDENTITY_HMAC_KEY = previousHmacKey;
  }
});

test('direct startup rejects missing and weak identity HMAC keys', async () => {
  for (const key of [undefined, 'too-short']) {
    const { error, stderr } = await runDirectStartup(key);
    assert.ok(error, `startup accepted ${key === undefined ? 'missing' : 'weak'} key`);
    assert.match(stderr, /IDENTITY_HMAC_KEY must be set to at least 32 bytes/);
  }
});

test('imported HMAC-dependent routes reject missing and weak keys', async () => {
  const routes = identityRoutes(stubIdentityDb() as never);
  const magicRoute = routes.find(
    (candidate) =>
      candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
  );
  const verifyRoute = routes.find(
    (candidate) =>
      candidate.method === 'POST' && candidate.path === '/internal/identity/verify-session',
  );
  assert.ok(magicRoute);
  assert.ok(verifyRoute);

  for (const key of [undefined, 'too-short']) {
    await withEnvironment({ IDENTITY_HMAC_KEY: key }, async () => {
      await assert.rejects(
        async () =>
          magicRoute.handler(
            { url: '/internal/identity/magic-link' } as never,
            { email: 'key-check@test.example' },
            {},
          ),
        /IDENTITY_HMAC_KEY must be set to at least 32 bytes/,
      );
      await assert.rejects(
        async () =>
          verifyRoute.handler(
            { url: '/internal/identity/verify-session' } as never,
            { sessionToken: 'e30.invalid' },
            {},
          ),
        /IDENTITY_HMAC_KEY must be set to at least 32 bytes/,
      );
    });
  }
});

test('explicit non-production stub exposes dev tokens without logging secrets', async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const logs: string[] = [];
  const audits: string[] = [];
  const email = 'dev-token@test.example';
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };
  globalThis.fetch = (async (_input, init) => {
    audits.push(String(init?.body));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    await withEnvironment(
      {
        AUDIT_INTERNAL_URL: 'http://audit.test',
        IDENTITY_DEV_TOKENS: 'true',
        IDENTITY_HMAC_KEY: TEST_HMAC_KEY,
        IDENTITY_MODE: 'stub',
        INTERNAL_API_TOKEN: 'audit-test-token',
        NODE_ENV: 'development',
      },
      async () => {
        const routes = identityRoutes(stubIdentityDb() as never);
        const magicRoute = routes.find(
          (candidate) =>
            candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
        );
        const devRoute = routes.find(
          (candidate) =>
            candidate.method === 'GET' && candidate.path === '/internal/identity/dev-tokens',
        );
        assert.ok(magicRoute);
        assert.ok(devRoute);

        const minted = (await magicRoute.handler(
          { url: '/internal/identity/magic-link' } as never,
          { email },
          {},
        )) as { status: number };
        assert.equal(minted.status, 200);
        const surfaced = (await devRoute.handler(
          { url: '/internal/identity/dev-tokens' } as never,
          {},
          {},
        )) as { status: number; body: { tokens: Record<string, string> } };
        assert.equal(surfaced.status, 200);
        const rawToken = surfaced.body.tokens[email];
        assert.match(rawToken, /^[0-9a-f]{64}$/);
        assert.ok(logs.every((entry) => !entry.includes(email) && !entry.includes(rawToken)));
        assert.equal(audits.length, 1);
        assert.doesNotMatch(audits[0], new RegExp(`${email}|${rawToken}`, 'i'));
        assert.equal(JSON.parse(audits[0]).visibility, 'restricted');
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
  }
});

test('production neither surfaces nor stores dev tokens when the flag is true', async () => {
  const previousFetch = globalThis.fetch;
  const email = 'production-token@test.example';
  globalThis.fetch = (async () => new Response('{}', { status: 202 })) as typeof fetch;
  try {
    await withEnvironment(
      {
        IDENTITY_DEV_TOKENS: 'true',
        IDENTITY_HMAC_KEY: TEST_HMAC_KEY,
        IDENTITY_MODE: 'stub',
        INTERNAL_API_TOKEN: 'audit-test-token',
        NODE_ENV: 'production',
      },
      async () => {
        const routes = identityRoutes(stubIdentityDb() as never);
        const magicRoute = routes.find(
          (candidate) =>
            candidate.method === 'POST' && candidate.path === '/internal/identity/magic-link',
        );
        const devRoute = routes.find(
          (candidate) =>
            candidate.method === 'GET' && candidate.path === '/internal/identity/dev-tokens',
        );
        assert.ok(magicRoute);
        assert.ok(devRoute);

        await magicRoute.handler({ url: '/internal/identity/magic-link' } as never, { email }, {});
        const denied = (await devRoute.handler(
          { url: '/internal/identity/dev-tokens' } as never,
          {},
          {},
        )) as { status: number };
        assert.equal(denied.status, 404);

        process.env.NODE_ENV = 'development';
        const surfaced = (await devRoute.handler(
          { url: '/internal/identity/dev-tokens' } as never,
          {},
          {},
        )) as { status: number; body: { tokens: Record<string, string> } };
        assert.equal(surfaced.status, 200);
        assert.equal(surfaced.body.tokens[email], undefined);
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startService, type Route } from '@polis/service-runtime';

import type { IdentityEnvironment } from './config.js';
import type { MagicLinkDelivery } from './delivery.js';
import type { CitizenRow, IdentityRepository } from './identity-repository.js';
import type { IdentityProvider } from './identity-provider.js';
import { identityRoutes, validateIdentityConfig } from './index.js';

const TEST_HMAC_KEY = 'identity-test-hmac-key-with-at-least-32-bytes';
const BASE_ENV: IdentityEnvironment = {
  IDENTITY_HMAC_KEY: TEST_HMAC_KEY,
  IDENTITY_MODE: 'stub',
  IDENTITY_MAGIC_LINK_DELIVERY: 'dev',
  IDENTITY_DEV_TOKENS: 'false',
  NODE_ENV: 'test',
};
const execFileAsync = promisify(execFile);

const devDelivery: MagicLinkDelivery = {
  mode: 'dev',
  async verify() {},
  async sendMagicLink() {},
};

function citizen(input: Partial<CitizenRow> & Pick<CitizenRow, 'id' | 'email'>): CitizenRow {
  return {
    id: input.id,
    email: input.email,
    displayName: input.displayName ?? input.email.split('@')[0] ?? 'Citizen',
    identityLevel: input.identityLevel ?? 'verified_resident',
    passcodeHash: input.passcodeHash ?? null,
    magicTokenHash: input.magicTokenHash ?? null,
    magicTokenExpiresAt: input.magicTokenExpiresAt ?? null,
    createdAt: input.createdAt ?? new Date('2026-09-05T10:00:00.000Z'),
  };
}

class MemoryIdentityRepository implements IdentityRepository {
  readonly byEmail = new Map<string, CitizenRow>();
  readonly revocations = new Map<string, Date>();
  private nextCitizen = 1;

  async issueMagicToken(input: {
    email: string;
    displayName: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<CitizenRow> {
    const existing = this.byEmail.get(input.email);
    const row = citizen({
      ...(existing ?? { id: `cit-test-${this.nextCitizen++}`, email: input.email }),
      displayName: existing?.displayName ?? input.displayName,
      magicTokenHash: input.tokenHash,
      magicTokenExpiresAt: input.expiresAt,
    });
    this.byEmail.set(input.email, row);
    return { ...row };
  }

  async consumeMagicToken(input: {
    email: string;
    tokenHash: string;
    consumedAt: Date;
  }): Promise<CitizenRow | null> {
    const row = this.byEmail.get(input.email);
    if (
      !row ||
      row.magicTokenHash !== input.tokenHash ||
      !row.magicTokenExpiresAt ||
      row.magicTokenExpiresAt.getTime() <= input.consumedAt.getTime()
    ) {
      return null;
    }
    const consumed = citizen({ ...row, magicTokenHash: null, magicTokenExpiresAt: null });
    this.byEmail.set(input.email, consumed);
    return { ...consumed };
  }

  async findByPasscodeHash(email: string, passcodeHash: string): Promise<CitizenRow | null> {
    const row = this.byEmail.get(email);
    return row?.passcodeHash === passcodeHash ? { ...row } : null;
  }

  async findCitizenById(citizenId: string): Promise<CitizenRow | null> {
    const row = [...this.byEmail.values()].find((candidate) => candidate.id === citizenId);
    return row ? { ...row } : null;
  }

  async revokeSession(input: {
    tokenHash: string;
    citizenId: string;
    expiresAt: Date;
    revokedAt: Date;
  }): Promise<boolean> {
    if (
      input.expiresAt.getTime() <= input.revokedAt.getTime() ||
      this.revocations.has(input.tokenHash)
    ) {
      return false;
    }
    this.revocations.set(input.tokenHash, input.expiresAt);
    return true;
  }

  async isSessionRevoked(tokenHash: string, checkedAt: Date): Promise<boolean> {
    const expiresAt = this.revocations.get(tokenHash);
    return !!expiresAt && expiresAt.getTime() > checkedAt.getTime();
  }

  async resolveOidcCitizen(input: {
    provider: string;
    subject: string;
    email: string;
  }): Promise<CitizenRow> {
    const existing = this.byEmail.get(input.email);
    if (existing) return { ...existing };
    const row = citizen({ id: `cit-oidc-${this.nextCitizen++}`, email: input.email });
    this.byEmail.set(input.email, row);
    return { ...row };
  }
}

function findRoute(routes: Route[], method: string, path: string): Route {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
  assert.ok(route, `missing ${method} ${path}`);
  return route;
}

function routeOutput(output: unknown): { status: number; body: Record<string, unknown> } {
  const value = output as { status: number; body: Record<string, unknown> };
  return { status: value.status, body: value.body };
}

function signedTestSession(
  citizenId: string,
  expiresAt: Date,
  method?: 'magic_link' | 'passcode' | 'oidc',
): string {
  const payload = Buffer.from(
    JSON.stringify({ citizenId, exp: expiresAt.getTime(), ...(method ? { method } : {}) }),
  );
  const signature = createHmac('sha256', TEST_HMAC_KEY).update(payload).digest('base64url');
  return `${payload.toString('base64url')}.${signature}`;
}

function sessionMethod(sessionToken: unknown): unknown {
  if (typeof sessionToken !== 'string') assert.fail('session token must be a string');
  const [payload] = sessionToken.split('.', 1);
  assert.ok(payload);
  return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { method?: unknown })
    .method;
}

function testRoutes(
  repository = new MemoryIdentityRepository(),
  overrides: Parameters<typeof identityRoutes>[1] = {},
): Route[] {
  return identityRoutes({} as never, {
    env: BASE_ENV,
    repository,
    delivery: devDelivery,
    auditEmitter: async () => {},
    ...overrides,
  });
}

test('identity service exposes magic-link, logout, verification, and OIDC contracts', () => {
  const paths = testRoutes().map((route) => `${route.method} ${route.path}`);
  for (const path of [
    'POST /internal/identity/magic-link',
    'POST /internal/identity/exchange',
    'POST /internal/identity/verify-session',
    'POST /internal/identity/logout',
    'GET /internal/identity/citizens/:id',
    'GET /internal/identity/dev-tokens',
    'GET /internal/identity/authorize',
    'POST /internal/identity/callback',
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test('OIDC mode blocks magic-link and passcode/token exchange before side effects', async () => {
  const repository = new MemoryIdentityRepository();
  let generatedTokens = 0;
  let deliveredMessages = 0;
  const delivery: MagicLinkDelivery = {
    mode: 'smtp',
    async verify() {},
    async sendMagicLink() {
      deliveredMessages += 1;
    },
  };
  const routes = testRoutes(repository, {
    env: {
      ...BASE_ENV,
      IDENTITY_MODE: 'oidc',
      IDENTITY_MAGIC_LINK_DELIVERY: 'smtp',
    },
    delivery,
    publicAppOrigin: 'https://pilot.example',
    randomMagicToken: () => {
      generatedTokens += 1;
      return 'must-not-be-generated';
    },
  });

  for (const [path, body] of [
    ['/internal/identity/magic-link', { email: 'resident@example.test' }],
    ['/internal/identity/exchange', { email: 'resident@example.test', token: 'legacy-token' }],
    [
      '/internal/identity/exchange',
      { email: 'resident@example.test', passcode: 'legacy-passcode' },
    ],
  ] as const) {
    const output = routeOutput(
      await findRoute(routes, 'POST', path).handler({ url: '/' } as never, body, {}),
    );
    assert.equal(output.status, 403);
    assert.deepEqual(output.body, { error: 'oidc_required' });
  }
  assert.equal(repository.byEmail.size, 0);
  assert.equal(generatedTokens, 0);
  assert.equal(deliveredMessages, 0);
});

test('identity internal routes reject unauthenticated real HTTP requests', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'identity-test-token';
  const server = startService('citizen-identity-service', 0, testRoutes());
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/internal/identity/dev-tokens`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'internal_auth_required',
      service: 'citizen-identity-service',
    });
  } finally {
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('magic-link audit uses internal auth and omits email and token', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousFetch = globalThis.fetch;
  const seen: { headers?: HeadersInit; body?: string } = {};
  process.env.INTERNAL_API_TOKEN = 'audit-test-token';
  globalThis.fetch = (async (_input, init) => {
    seen.headers = init?.headers;
    seen.body = String(init?.body);
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    const routes = identityRoutes({} as never, {
      env: { ...BASE_ENV, AUDIT_INTERNAL_URL: 'http://audit.test' },
      repository: new MemoryIdentityRepository(),
      delivery: devDelivery,
      randomMagicToken: () => 'audit-synthetic-token',
    });
    const output = routeOutput(
      await findRoute(routes, 'POST', '/internal/identity/magic-link').handler(
        { url: '/internal/identity/magic-link' } as never,
        { email: 'Ada@Test.Example' },
        {},
      ),
    );
    assert.equal(output.status, 200);
    assert.deepEqual(output.body, { sent: true });
    assert.deepEqual(seen.headers, {
      'content-type': 'application/json',
      'x-polis-internal-token': 'audit-test-token',
    });
    assert.ok(seen.body);
    assert.doesNotMatch(seen.body, /ada@test\.example|audit-synthetic-token/i);
    assert.equal(JSON.parse(seen.body).visibility, 'restricted');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('audit failure warning is stable and carries no upstream detail', async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const warnings: string[] = [];
  delete process.env.INTERNAL_API_TOKEN;
  globalThis.fetch = (async () => {
    throw new Error('resident@example.test secret-token');
  }) as typeof fetch;
  console.error = (message?: unknown) => warnings.push(String(message));
  try {
    const routes = identityRoutes({} as never, {
      env: { ...BASE_ENV, AUDIT_INTERNAL_URL: 'http://audit.test' },
      repository: new MemoryIdentityRepository(),
      delivery: devDelivery,
      randomMagicToken: () => 'secret-token',
    });
    const output = routeOutput(
      await findRoute(routes, 'POST', '/internal/identity/magic-link').handler(
        { url: '/' } as never,
        { email: 'resident@example.test' },
        {},
      ),
    );
    assert.equal(output.status, 200);
    assert.deepEqual(JSON.parse(warnings[0]!), {
      service: 'citizen-identity-service',
      stage: 'audit-emit',
      warning: 'audit_unavailable',
    });
    assert.doesNotMatch(warnings.join('\n'), /resident@example|secret-token/);
  } finally {
    console.error = previousError;
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
});

test('direct startup and imported config reject missing or weak HMAC keys', async () => {
  for (const key of [undefined, 'too-short']) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: '0',
      IDENTITY_MODE: 'stub',
      IDENTITY_MAGIC_LINK_DELIVERY: 'dev',
      IDENTITY_DEV_TOKENS: 'false',
      NODE_ENV: 'test',
    };
    delete env.DATABASE_URL;
    if (key === undefined) delete env.IDENTITY_HMAC_KEY;
    else env.IDENTITY_HMAC_KEY = key;
    await assert.rejects(
      execFileAsync(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], {
        encoding: 'utf8',
        env,
        timeout: 10_000,
      }),
      (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /IDENTITY_HMAC_KEY must be set to at least 32 bytes/);
        return true;
      },
    );
    assert.throws(() => validateIdentityConfig({ ...BASE_ENV, IDENTITY_HMAC_KEY: key }));
  }
});

test('SMTP startup config fails closed and SMTP mode disables dev-token surface', async () => {
  assert.throws(
    () =>
      validateIdentityConfig({
        ...BASE_ENV,
        IDENTITY_MAGIC_LINK_DELIVERY: 'smtp',
      }),
    /SMTP_HOST is required/,
  );

  const smtpDelivery: MagicLinkDelivery = {
    mode: 'smtp',
    async verify() {},
    async sendMagicLink() {},
  };
  const routes = identityRoutes({} as never, {
    env: {
      ...BASE_ENV,
      IDENTITY_DEV_TOKENS: 'true',
      IDENTITY_MAGIC_LINK_DELIVERY: 'smtp',
    },
    repository: new MemoryIdentityRepository(),
    delivery: smtpDelivery,
    publicAppOrigin: 'https://pilot.example',
    auditEmitter: async () => {},
  });
  const output = routeOutput(
    await findRoute(routes, 'GET', '/internal/identity/dev-tokens').handler(
      { url: '/' } as never,
      {},
      {},
    ),
  );
  assert.equal(output.status, 404);
});

test('dev tokens require every explicit nonproduction gate and never enter logs', async () => {
  const previousLog = console.log;
  const logs: string[] = [];
  console.log = (message?: unknown) => logs.push(String(message));
  try {
    const email = 'dev-token@example.test';
    const token = 'local-synthetic-token';
    const routes = identityRoutes({} as never, {
      env: {
        ...BASE_ENV,
        IDENTITY_DEV_TOKENS: 'true',
        NODE_ENV: 'development',
      },
      repository: new MemoryIdentityRepository(),
      delivery: devDelivery,
      randomMagicToken: () => token,
      auditEmitter: async () => {},
    });
    await findRoute(routes, 'POST', '/internal/identity/magic-link').handler(
      { url: '/' } as never,
      { email },
      {},
    );
    const output = routeOutput(
      await findRoute(routes, 'GET', '/internal/identity/dev-tokens').handler(
        { url: '/' } as never,
        {},
        {},
      ),
    );
    assert.equal(output.status, 200);
    assert.equal((output.body.tokens as Record<string, string>)[email], token);
    assert.doesNotMatch(logs.join('\n'), new RegExp(`${email}|${token}`, 'i'));
  } finally {
    console.log = previousLog;
  }
});

test('SMTP delivery failures return the same generic response without PII or token logs', async () => {
  const previousError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  const repository = new MemoryIdentityRepository();
  const delivery: MagicLinkDelivery = {
    mode: 'smtp',
    async verify() {},
    async sendMagicLink(message) {
      throw new Error(`${message.to} ${message.loginUrl}`);
    },
  };
  try {
    const routes = identityRoutes({} as never, {
      env: { ...BASE_ENV, IDENTITY_MAGIC_LINK_DELIVERY: 'smtp' },
      repository,
      delivery,
      publicAppOrigin: 'https://pilot.example',
      randomMagicToken: () => 'smtp-synthetic-token',
      auditEmitter: async () => {},
    });
    const magic = findRoute(routes, 'POST', '/internal/identity/magic-link');
    const outputs = await Promise.all([
      magic.handler({ url: '/' } as never, { email: 'existing@example.test' }, {}),
      magic.handler({ url: '/' } as never, { email: 'new@example.test' }, {}),
    ]);
    for (const output of outputs.map(routeOutput)) {
      assert.equal(output.status, 200);
      assert.deepEqual(output.body, { sent: true });
      assert.doesNotMatch(JSON.stringify(output.body), /example\.test|smtp-synthetic-token/);
    }
    assert.equal(logs.length, 2);
    assert.doesNotMatch(logs.join('\n'), /existing@example|new@example|smtp-synthetic-token/);
    for (const log of logs) {
      assert.deepEqual(JSON.parse(log), {
        service: 'citizen-identity-service',
        stage: 'magic-link-delivery',
        warning: 'delivery_failed',
      });
    }
  } finally {
    console.error = previousError;
  }
});

test('conditional magic-token claim has one concurrent winner and tokens are single-use', async () => {
  const repository = new MemoryIdentityRepository();
  const email = 'concurrent@example.test';
  const rawToken = 'concurrent-synthetic-token';
  const routes = testRoutes(repository, { randomMagicToken: () => rawToken });
  const magic = findRoute(routes, 'POST', '/internal/identity/magic-link');
  const exchange = findRoute(routes, 'POST', '/internal/identity/exchange');

  assert.equal(routeOutput(await magic.handler({ url: '/' } as never, { email }, {})).status, 200);
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      exchange.handler({ url: '/' } as never, { email, token: rawToken }, {}),
    ),
  );
  assert.deepEqual(
    attempts.map((output) => routeOutput(output).status).sort(),
    [200, 401, 401, 401, 401, 401, 401, 401],
  );
  const reused = routeOutput(
    await exchange.handler({ url: '/' } as never, { email, token: rawToken }, {}),
  );
  assert.equal(reused.status, 401);
  assert.deepEqual(reused.body, { error: 'invalid_credentials' });
});

test('session verification preserves contract, logout is restart-safe and idempotent', async () => {
  const repository = new MemoryIdentityRepository();
  let current = new Date('2026-09-05T12:00:00.000Z');
  const email = 'session@example.test';
  const auditEvents: string[] = [];
  const routes = testRoutes(repository, {
    now: () => current,
    randomMagicToken: () => 'session-synthetic-token',
    auditEmitter: async (event) => {
      auditEvents.push(event.eventType);
    },
  });
  await findRoute(routes, 'POST', '/internal/identity/magic-link').handler(
    { url: '/' } as never,
    { email },
    {},
  );
  const exchanged = routeOutput(
    await findRoute(routes, 'POST', '/internal/identity/exchange').handler(
      { url: '/' } as never,
      { email, token: 'session-synthetic-token' },
      {},
    ),
  );
  assert.equal(exchanged.status, 200);
  const sessionToken = exchanged.body.sessionToken;
  assert.equal(typeof sessionToken, 'string');
  assert.equal(sessionMethod(sessionToken), 'magic_link');

  const verify = findRoute(routes, 'POST', '/internal/identity/verify-session');
  const before = routeOutput(await verify.handler({ url: '/' } as never, { sessionToken }, {}));
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, {
    citizenId: 'cit-test-1',
    identityLevel: 'verified_resident',
  });

  const logout = findRoute(routes, 'POST', '/internal/identity/logout');
  assert.deepEqual(routeOutput(await logout.handler({ url: '/' } as never, { sessionToken }, {})), {
    status: 200,
    body: { revoked: true },
  });
  assert.deepEqual(routeOutput(await logout.handler({ url: '/' } as never, { sessionToken }, {})), {
    status: 200,
    body: { revoked: true },
  });
  assert.equal(repository.revocations.size, 1);
  assert.equal(auditEvents.filter((event) => event === 'identity.session.revoked').length, 1);
  assert.ok(
    [...repository.revocations.keys()].every(
      (hash) => hash !== sessionToken && !hash.includes('.'),
    ),
  );

  const afterRestart = testRoutes(repository, { now: () => current });
  const denied = routeOutput(
    await findRoute(afterRestart, 'POST', '/internal/identity/verify-session').handler(
      { url: '/' } as never,
      { sessionToken },
      {},
    ),
  );
  assert.equal(denied.status, 401);

  current = new Date('2026-09-05T21:00:00.000Z');
  const expiredLogout = routeOutput(
    await findRoute(afterRestart, 'POST', '/internal/identity/logout').handler(
      { url: '/' } as never,
      { sessionToken },
      {},
    ),
  );
  assert.deepEqual(expiredLogout, { status: 200, body: { revoked: true } });
  const invalidLogout = routeOutput(
    await findRoute(afterRestart, 'POST', '/internal/identity/logout').handler(
      { url: '/' } as never,
      { sessionToken: 'not-a-session' },
      {},
    ),
  );
  assert.deepEqual(invalidLogout, { status: 200, body: { revoked: true } });
  const missingLogout = routeOutput(
    await findRoute(afterRestart, 'POST', '/internal/identity/logout').handler(
      { url: '/' } as never,
      {},
      {},
    ),
  );
  assert.deepEqual(missingLogout, {
    status: 400,
    body: { error: 'invalid_logout_payload' },
  });
});

test('switching to OIDC rejects legacy, magic-link, and passcode sessions but accepts OIDC sessions', async () => {
  const repository = new MemoryIdentityRepository();
  const current = new Date('2026-09-05T12:00:00.000Z');
  const stubRoutes = testRoutes(repository, {
    now: () => current,
    randomMagicToken: () => 'pre-switch-token',
  });
  await findRoute(stubRoutes, 'POST', '/internal/identity/magic-link').handler(
    { url: '/' } as never,
    { email: 'pre-switch@example.test' },
    {},
  );
  const stubExchange = routeOutput(
    await findRoute(stubRoutes, 'POST', '/internal/identity/exchange').handler(
      { url: '/' } as never,
      { email: 'pre-switch@example.test', token: 'pre-switch-token' },
      {},
    ),
  );
  const magicSession = stubExchange.body.sessionToken;
  assert.equal(sessionMethod(magicSession), 'magic_link');

  const citizenId = 'cit-test-1';
  const expiresAt = new Date(current.getTime() + 60_000);
  const legacySession = signedTestSession(citizenId, expiresAt);
  const passcodeSession = signedTestSession(citizenId, expiresAt, 'passcode');
  const stubVerify = findRoute(stubRoutes, 'POST', '/internal/identity/verify-session');
  assert.equal(
    routeOutput(
      await stubVerify.handler({ url: '/' } as never, { sessionToken: legacySession }, {}),
    ).status,
    200,
  );
  const oidcEnv = { ...BASE_ENV, IDENTITY_MODE: 'oidc' };
  const oidcRoutes = testRoutes(repository, {
    env: oidcEnv,
    now: () => current,
    identityProviderFactory: () => ({
      async beginLogin() {
        return { authorizationUrl: 'https://issuer.example/auth', state: 'state' };
      },
      async completeLogin() {
        return {
          provider: 'oidc:https://issuer.example',
          subject: 'oidc-subject',
          email: 'oidc-session@example.test',
          emailVerified: true,
        };
      },
    }),
  });
  const verify = findRoute(oidcRoutes, 'POST', '/internal/identity/verify-session');
  for (const sessionToken of [legacySession, magicSession, passcodeSession]) {
    const output = routeOutput(await verify.handler({ url: '/' } as never, { sessionToken }, {}));
    assert.equal(output.status, 401);
    assert.deepEqual(output.body, { error: 'invalid_session' });
  }

  const callback = routeOutput(
    await findRoute(oidcRoutes, 'POST', '/internal/identity/callback').handler(
      { url: '/' } as never,
      {
        code: 'code',
        state: 'state',
        redirectUri: 'https://pilot.example/callback',
      },
      {},
    ),
  );
  assert.equal(callback.status, 200);
  assert.equal(sessionMethod(callback.body.sessionToken), 'oidc');
  const verifiedOidc = routeOutput(
    await verify.handler({ url: '/' } as never, { sessionToken: callback.body.sessionToken }, {}),
  );
  assert.equal(verifiedOidc.status, 200);
  assert.deepEqual(verifiedOidc.body, {
    citizenId: 'cit-oidc-2',
    identityLevel: 'verified_resident',
  });
});

test('expired magic links and sessions fail closed at the exact TTL boundary', async () => {
  const repository = new MemoryIdentityRepository();
  let current = new Date('2026-09-05T12:00:00.000Z');
  const routes = testRoutes(repository, {
    now: () => current,
    randomMagicToken: () => 'expiring-token',
  });
  const magic = findRoute(routes, 'POST', '/internal/identity/magic-link');
  const exchange = findRoute(routes, 'POST', '/internal/identity/exchange');
  const verify = findRoute(routes, 'POST', '/internal/identity/verify-session');

  await magic.handler({ url: '/' } as never, { email: 'expired-link@example.test' }, {});
  current = new Date(current.getTime() + 15 * 60_000);
  assert.equal(
    routeOutput(
      await exchange.handler(
        { url: '/' } as never,
        { email: 'expired-link@example.test', token: 'expiring-token' },
        {},
      ),
    ).status,
    401,
  );

  current = new Date('2026-09-05T12:00:00.000Z');
  await magic.handler({ url: '/' } as never, { email: 'expired-session@example.test' }, {});
  const exchanged = routeOutput(
    await exchange.handler(
      { url: '/' } as never,
      { email: 'expired-session@example.test', token: 'expiring-token' },
      {},
    ),
  );
  const sessionToken = exchanged.body.sessionToken;
  current = new Date(current.getTime() + 8 * 60 * 60_000);
  assert.equal(
    routeOutput(await verify.handler({ url: '/' } as never, { sessionToken }, {})).status,
    401,
  );
});

test('OIDC callback keeps provider failures safe and enforces verified email', async () => {
  const env = { ...BASE_ENV, IDENTITY_MODE: 'oidc' };
  const repository = new MemoryIdentityRepository();
  const provider = (completeLogin: IdentityProvider['completeLogin']): IdentityProvider => ({
    async beginLogin() {
      return { authorizationUrl: 'https://issuer.example/auth', state: 'state' };
    },
    completeLogin,
  });
  const callbackBody = {
    code: 'code',
    state: 'state',
    redirectUri: 'https://pilot.example/callback',
  };

  for (const [error, status, code] of [
    ['invalid_state', 400, 'invalid_state'],
    ['provider_unavailable', 503, 'identity_provider_unavailable'],
    ['provider secret detail', 400, 'login_failed'],
  ] as const) {
    const routes = testRoutes(repository, {
      env,
      identityProviderFactory: () =>
        provider(async () => {
          throw new Error(error);
        }),
    });
    const output = routeOutput(
      await findRoute(routes, 'POST', '/internal/identity/callback').handler(
        { url: '/' } as never,
        callbackBody,
        {},
      ),
    );
    assert.equal(output.status, status);
    assert.deepEqual(output.body, { error: code });
    assert.doesNotMatch(JSON.stringify(output.body), /secret detail/);
  }

  const unverifiedRoutes = testRoutes(repository, {
    env,
    identityProviderFactory: () =>
      provider(async () => ({
        provider: 'oidc:https://issuer.example',
        subject: 'subject',
        email: 'resident@example.test',
        emailVerified: false,
      })),
  });
  const unverified = routeOutput(
    await findRoute(unverifiedRoutes, 'POST', '/internal/identity/callback').handler(
      { url: '/' } as never,
      callbackBody,
      {},
    ),
  );
  assert.equal(unverified.status, 403);
  assert.deepEqual(unverified.body, { error: 'email_not_verified' });
});

test('legacy unknown-issuer OIDC bindings stop login for operator review without PII logs', async () => {
  const previousError = console.error;
  const logs: string[] = [];
  console.error = (message?: unknown) => logs.push(String(message));
  const repository = new MemoryIdentityRepository();
  repository.resolveOidcCitizen = async () => {
    throw new Error('legacy_oidc_binding_review_required');
  };
  try {
    const routes = testRoutes(repository, {
      env: { ...BASE_ENV, IDENTITY_MODE: 'oidc' },
      identityProviderFactory: () => ({
        async beginLogin() {
          return { authorizationUrl: 'https://issuer.example/auth', state: 'state' };
        },
        async completeLogin() {
          return {
            provider: 'oidc:https://issuer.example',
            subject: 'sensitive-subject',
            email: 'resident@example.test',
            emailVerified: true,
          };
        },
      }),
    });
    const output = routeOutput(
      await findRoute(routes, 'POST', '/internal/identity/callback').handler(
        { url: '/' } as never,
        {
          code: 'code',
          state: 'state',
          redirectUri: 'https://pilot.example/callback',
        },
        {},
      ),
    );
    assert.equal(output.status, 503);
    assert.deepEqual(output.body, { error: 'identity_binding_review_required' });
    assert.deepEqual(JSON.parse(logs[0]!), {
      service: 'citizen-identity-service',
      stage: 'oidc-binding',
      warning: 'legacy_binding_operator_review_required',
    });
    assert.doesNotMatch(logs.join('\n'), /resident@example|sensitive-subject|issuer\.example/);
  } finally {
    console.error = previousError;
  }
});

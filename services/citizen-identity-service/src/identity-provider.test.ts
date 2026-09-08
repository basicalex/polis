import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentityProvider } from './identity-provider.js';
import type { OidcLoginState, OidcLoginStateStore } from './oidc-state-store.js';

class MemoryStateStore implements OidcLoginStateStore {
  readonly entries = new Map<string, OidcLoginState>();

  async create(state: string, entry: OidcLoginState): Promise<void> {
    this.entries.set(state, { ...entry });
  }

  async consume(state: string, consumedAt: Date): Promise<OidcLoginState | null> {
    const entry = this.entries.get(state);
    if (!entry || entry.expiresAt.getTime() <= consumedAt.getTime()) return null;
    this.entries.delete(state);
    return { ...entry };
  }
}

const OIDC_ENV = {
  IDENTITY_MODE: 'oidc',
  IDENTITY_ALLOW_HTTP_LOCALHOST: 'true',
  NODE_ENV: 'test',
  OIDC_ISSUER: 'http://127.0.0.1:9000/realms/polis',
  OIDC_AUTHORIZATION_ISSUER: 'http://localhost:9000/realms/polis',
  OIDC_CLIENT_ID: 'polis-web',
  OIDC_CLIENT_SECRET: 'synthetic-client-secret',
  OIDC_REDIRECT_URIS: 'http://127.0.0.1:4321/login/callback',
} as const;

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'synthetic-signature',
  ].join('.');
}

function successfulProviderFetch(input: {
  nonce: () => string;
  now: () => Date;
  issuer?: string;
  audience?: string;
  emailVerified?: boolean;
  onTokenBody?: (body: URLSearchParams) => void;
}): typeof fetch {
  return (async (request, init) => {
    const url = String(request);
    if (url.endsWith('/protocol/openid-connect/token')) {
      input.onTokenBody?.(new URLSearchParams(String(init?.body)));
      return new Response(
        JSON.stringify({
          access_token: 'synthetic-access-token',
          id_token: unsignedJwt({
            iss: input.issuer ?? OIDC_ENV.OIDC_ISSUER,
            aud: input.audience ?? OIDC_ENV.OIDC_CLIENT_ID,
            sub: 'provider-subject-1',
            nonce: input.nonce(),
            exp: Math.floor(input.now().getTime() / 1000) + 300,
          }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/protocol/openid-connect/userinfo')) {
      assert.equal(
        (init?.headers as Record<string, string>).authorization,
        'Bearer synthetic-access-token',
      );
      return new Response(
        JSON.stringify({
          sub: 'provider-subject-1',
          email: 'Resident@Example.Test',
          email_verified: input.emailVerified ?? true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;
}

test('OIDC state survives provider recreation and is consumed once with PKCE and nonce', async () => {
  const store = new MemoryStateStore();
  const current = new Date('2026-09-05T12:00:00.000Z');
  let nonce = '';
  let tokenBody: URLSearchParams | undefined;
  const fetchImpl = successfulProviderFetch({
    nonce: () => nonce,
    now: () => current,
    onTokenBody: (body) => {
      tokenBody = body;
    },
  });
  const firstProcess = createIdentityProvider({
    stateStore: store,
    env: OIDC_ENV,
    fetchImpl,
    now: () => current,
  });
  const begun = await firstProcess.beginLogin('http://127.0.0.1:4321/login/callback');
  const authorization = new URL(begun.authorizationUrl);
  nonce = authorization.searchParams.get('nonce') ?? '';
  assert.ok(nonce);
  assert.equal(authorization.searchParams.get('state'), begun.state);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(store.entries.size, 1);

  const restartedProcess = createIdentityProvider({
    stateStore: store,
    env: OIDC_ENV,
    fetchImpl,
    now: () => current,
  });
  const resolved = await restartedProcess.completeLogin(
    'synthetic-code',
    begun.state,
    'http://127.0.0.1:4321/login/callback',
  );
  assert.deepEqual(resolved, {
    provider: `oidc:${OIDC_ENV.OIDC_ISSUER}`,
    subject: 'provider-subject-1',
    email: 'resident@example.test',
    emailVerified: true,
  });
  assert.equal(store.entries.size, 0);
  assert.equal(tokenBody?.get('redirect_uri'), 'http://127.0.0.1:4321/login/callback');
  assert.match(tokenBody?.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43}$/);

  await assert.rejects(
    restartedProcess.completeLogin(
      'synthetic-code',
      begun.state,
      'http://127.0.0.1:4321/login/callback',
    ),
    /invalid_state/,
  );
});

test('OIDC redirect allowlist rejects arbitrary redirects and mismatch consumes state', async () => {
  const store = new MemoryStateStore();
  const current = new Date('2026-09-05T12:00:00.000Z');
  let fetchCalls = 0;
  const provider = createIdentityProvider({
    stateStore: store,
    env: OIDC_ENV,
    now: () => current,
    fetchImpl: (async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    }) as typeof fetch,
  });
  await assert.rejects(
    provider.beginLogin('https://attacker.example/callback'),
    /redirect_uri_not_allowed/,
  );

  const begun = await provider.beginLogin('http://127.0.0.1:4321/login/callback');
  await assert.rejects(
    provider.completeLogin('code', begun.state, 'http://127.0.0.1:4321/login/other'),
    /invalid_state/,
  );
  await assert.rejects(
    provider.completeLogin('code', begun.state, 'http://127.0.0.1:4321/login/callback'),
    /invalid_state/,
  );
  assert.equal(fetchCalls, 0);
});

test('OIDC state TTL rejects expired state without contacting the provider', async () => {
  const store = new MemoryStateStore();
  let current = new Date('2026-09-05T12:00:00.000Z');
  let fetchCalls = 0;
  const provider = createIdentityProvider({
    stateStore: store,
    env: OIDC_ENV,
    stateTtlMs: 1_000,
    now: () => current,
    fetchImpl: (async () => {
      fetchCalls += 1;
      throw new Error('must not fetch');
    }) as typeof fetch,
  });
  const begun = await provider.beginLogin('http://127.0.0.1:4321/login/callback');
  current = new Date(current.getTime() + 1_001);
  await assert.rejects(
    provider.completeLogin('code', begun.state, 'http://127.0.0.1:4321/login/callback'),
    /invalid_state/,
  );
  assert.equal(fetchCalls, 0);
});

test('OIDC provider failures are stable and consume state before network I/O', async () => {
  const store = new MemoryStateStore();
  const current = new Date('2026-09-05T12:00:00.000Z');
  const provider = createIdentityProvider({
    stateStore: store,
    env: OIDC_ENV,
    now: () => current,
    fetchImpl: (async () => {
      throw new Error('connect secret-provider.internal failed');
    }) as typeof fetch,
  });
  const begun = await provider.beginLogin('http://127.0.0.1:4321/login/callback');
  await assert.rejects(
    provider.completeLogin('code', begun.state, 'http://127.0.0.1:4321/login/callback'),
    (error: Error) => {
      assert.equal(error.message, 'provider_unavailable');
      assert.doesNotMatch(error.message, /secret-provider/);
      return true;
    },
  );
  await assert.rejects(
    provider.completeLogin('code', begun.state, 'http://127.0.0.1:4321/login/callback'),
    /invalid_state/,
  );
});

test('OIDC rejects wrong issuer or audience and preserves verified-email result', async () => {
  for (const variant of [
    { issuer: 'https://wrong-issuer.example', audience: OIDC_ENV.OIDC_CLIENT_ID },
    { issuer: OIDC_ENV.OIDC_ISSUER, audience: 'wrong-client' },
  ]) {
    const store = new MemoryStateStore();
    const current = new Date('2026-09-05T12:00:00.000Z');
    let nonce = '';
    const provider = createIdentityProvider({
      stateStore: store,
      env: OIDC_ENV,
      now: () => current,
      fetchImpl: successfulProviderFetch({
        nonce: () => nonce,
        now: () => current,
        ...variant,
      }),
    });
    const begun = await provider.beginLogin('http://127.0.0.1:4321/login/callback');
    nonce = new URL(begun.authorizationUrl).searchParams.get('nonce') ?? '';
    await assert.rejects(
      provider.completeLogin('code', begun.state, 'http://127.0.0.1:4321/login/callback'),
      /id_token_invalid/,
    );
  }

  const store = new MemoryStateStore();
  const current = new Date('2026-09-05T12:00:00.000Z');
  let nonce = '';
  const provider = createIdentityProvider({
    stateStore: store,
    env: OIDC_ENV,
    now: () => current,
    fetchImpl: successfulProviderFetch({
      nonce: () => nonce,
      now: () => current,
      emailVerified: false,
    }),
  });
  const begun = await provider.beginLogin('http://127.0.0.1:4321/login/callback');
  nonce = new URL(begun.authorizationUrl).searchParams.get('nonce') ?? '';
  const resolved = await provider.completeLogin(
    'code',
    begun.state,
    'http://127.0.0.1:4321/login/callback',
  );
  assert.equal(resolved.emailVerified, false);
});

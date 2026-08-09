import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  FetchTimeoutError,
  ReadinessController,
  binaryResult,
  fetchWithTimeout,
  internalHeaders,
  operationalRoutes,
  parseDeploymentProfile,
  startService,
  trustedActorHeaders,
  validateRuntimeConfig,
  versionMeta,
  type Route,
  type StartServiceOptions,
} from './index.js';

async function withServer(
  routes: Route[],
  run: (baseUrl: string) => Promise<void>,
  options: StartServiceOptions = {},
): Promise<void> {
  const server = startService('runtime-test', 0, routes, options);
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
}

async function withInternalToken(
  token: string | undefined,
  run: () => Promise<void>,
): Promise<void> {
  const previous = process.env.INTERNAL_API_TOKEN;
  if (token === undefined) delete process.env.INTERNAL_API_TOKEN;
  else process.env.INTERNAL_API_TOKEN = token;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
}

async function withEnvironment(
  changes: Readonly<Record<string, string | undefined>>,
  run: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(changes)) {
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

test('operationalRoutes exposes the four operational endpoints', () => {
  const paths = operationalRoutes('x').map((route) => route.path);
  for (const path of ['/healthz', '/readyz', '/metrics', '/version']) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test('versionMeta carries source/build transparency fields', () => {
  const meta = versionMeta('platform-api');
  assert.equal(meta.service, 'platform-api');
  assert.ok('version' in meta && 'gitSha' in meta && 'buildTime' in meta && 'sourceUrl' in meta);
});

test('open ops stay available while internal routes require the configured token', async () => {
  await withInternalToken('correct-token', async () => {
    let handlerCalls = 0;
    const routes: Route[] = [
      ...operationalRoutes('runtime-test'),
      {
        method: 'POST',
        path: '/internal/work',
        maxBodyBytes: 1,
        handler: (_req, body) => {
          handlerCalls += 1;
          return body;
        },
      },
    ];
    await withServer(routes, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/healthz`);
      assert.equal(health.status, 200);

      const missing = await fetch(`${baseUrl}/internal/work`, {
        method: 'POST',
        body: 'oversized and invalid',
      });
      assert.equal(missing.status, 401);
      assert.deepEqual(await missing.json(), {
        error: 'internal_auth_required',
        service: 'runtime-test',
      });

      const bad = await fetch(`${baseUrl}/internal/work`, {
        method: 'POST',
        headers: { 'x-polis-internal-token': 'wrong-token' },
        body: 'x',
      });
      assert.equal(bad.status, 401);

      const good = await fetch(`${baseUrl}/internal/work`, {
        method: 'POST',
        headers: { 'x-polis-internal-token': 'correct-token' },
      });
      assert.equal(good.status, 200);
      assert.deepEqual(await good.json(), {});
      assert.equal(handlerCalls, 1);
    });
  });
});

test('internal routes fail closed when INTERNAL_API_TOKEN is not configured', async () => {
  await withInternalToken(undefined, async () => {
    await withServer(
      [
        ...operationalRoutes('runtime-test'),
        { method: 'GET', path: '/internal/work', handler: () => ({ ok: true }) },
      ],
      async (baseUrl) => {
        const health = await fetch(`${baseUrl}/healthz`);
        assert.equal(health.status, 200);
        const response = await fetch(`${baseUrl}/internal/work`, {
          headers: { 'x-polis-internal-token': 'any-value' },
        });
        assert.equal(response.status, 401);
      },
    );
  });
});

test('public-shaped routes reject forged or partial actor context and accept trusted actors', async () => {
  await withInternalToken('trusted-channel-token', async () => {
    let handlerCalls = 0;
    await withServer(
      [
        {
          method: 'POST',
          path: '/api/v1/contribute/evidence',
          handler: (req) => {
            handlerCalls += 1;
            return {
              citizenId: req.headers['x-polis-citizen'],
              identityLevel: req.headers['x-polis-identity-level'],
            };
          },
        },
      ],
      async (baseUrl) => {
        const request = (headers: Record<string, string>) =>
          fetch(`${baseUrl}/api/v1/contribute/evidence`, {
            method: 'POST',
            headers,
            body: '{}',
          });

        const forgedHeaders: Array<Record<string, string>> = [
          { 'x-polis-citizen': 'forged-citizen' },
          { 'x-polis-identity-level': 'staff' },
          { 'x-polis-internal-token': 'wrong-token' },
          {
            'x-polis-internal-token': 'wrong-token',
            'x-polis-citizen': 'forged-citizen',
            'x-polis-identity-level': 'staff',
          },
        ];
        const partialActors: Array<Record<string, string>> = [
          {
            'x-polis-internal-token': 'trusted-channel-token',
            'x-polis-citizen': 'trusted-citizen',
          },
          {
            'x-polis-internal-token': 'trusted-channel-token',
            'x-polis-identity-level': 'verified_resident',
          },
        ];

        for (const headers of forgedHeaders) {
          const response = await request(headers);
          assert.equal(response.status, 401);
          assert.deepEqual(await response.json(), {
            error: 'internal_auth_required',
            service: 'runtime-test',
          });
        }

        for (const headers of partialActors) {
          const response = await request(headers);
          assert.equal(response.status, 401);
          assert.deepEqual(await response.json(), {
            error: 'trusted_actor_required',
            service: 'runtime-test',
          });
        }

        const accepted = await request({
          'x-polis-internal-token': 'trusted-channel-token',
          'x-polis-citizen': 'trusted-citizen',
          'x-polis-identity-level': 'verified_resident',
        });
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), {
          citizenId: 'trusted-citizen',
          identityLevel: 'verified_resident',
        });
        assert.equal(handlerCalls, 1);
      },
    );
  });
});

test('default JSON, raw, and none body modes reach handlers with the expected value', async () => {
  const routes: Route[] = [
    { method: 'POST', path: '/json', handler: (_req, body) => body },
    {
      method: 'POST',
      path: '/raw',
      bodyMode: 'raw',
      handler: (_req, body) => {
        assert.ok(Buffer.isBuffer(body));
        return { bytes: [...body] };
      },
    },
    { method: 'POST', path: '/none', bodyMode: 'none', handler: (_req, body) => body },
  ];
  await withServer(routes, async (baseUrl) => {
    const jsonResponse = await fetch(`${baseUrl}/json`, {
      method: 'POST',
      body: JSON.stringify({ value: 42 }),
    });
    assert.deepEqual(await jsonResponse.json(), { value: 42 });

    const rawResponse = await fetch(`${baseUrl}/raw`, {
      method: 'POST',
      body: new Uint8Array([0, 1, 255]),
    });
    assert.deepEqual(await rawResponse.json(), { bytes: [0, 1, 255] });

    const noneResponse = await fetch(`${baseUrl}/none`, { method: 'POST', body: 'ignored' });
    assert.deepEqual(await noneResponse.json(), {});
  });
});

test('route-specific body caps produce a typed 413 response', async () => {
  await withServer(
    [{ method: 'POST', path: '/small', maxBodyBytes: 3, handler: () => ({ unreachable: true }) }],
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/small`, { method: 'POST', body: 'four' });
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: 'body_too_large', service: 'runtime-test' });
    },
  );
});

test('unexpected handler errors are logged without leaking details to clients', async () => {
  const originalConsoleError = console.error;
  const logged: string[] = [];
  console.error = (...values: unknown[]) => {
    logged.push(values.map(String).join(' '));
  };
  try {
    await withServer(
      [
        {
          method: 'GET',
          path: '/failure',
          handler: () => {
            throw new Error('artifact_insert_conflict');
          },
        },
      ],
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/failure`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          error: 'internal_error',
          service: 'runtime-test',
        });
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logged.length, 1);
  const entry = JSON.parse(logged[0] ?? '{}') as {
    service?: string;
    stage?: string;
    error?: { message?: string; stack?: string | null };
  };
  assert.equal(entry.service, 'runtime-test');
  assert.equal(entry.stage, 'request');
  assert.equal(entry.error?.message, 'artifact_insert_conflict');
  assert.match(entry.error?.stack ?? '', /artifact_insert_conflict/);
});

test('binaryResult emits exact bytes, status, content type, and safe headers', async () => {
  await withServer(
    [
      {
        method: 'GET',
        path: '/file',
        handler: () =>
          binaryResult(206, new Uint8Array([0, 255, 1]), 'application/octet-stream', {
            'content-disposition': 'attachment; filename="sample.bin"',
            'set-cookie': 'must-not-emit=true',
          }),
      },
    ],
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/file`);
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.equal(
        response.headers.get('content-disposition'),
        'attachment; filename="sample.bin"',
      );
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 255, 1]));
    },
  );
});

test('internal header helpers require a token and protect trusted values', async () => {
  await withInternalToken(undefined, async () => {
    assert.throws(() => internalHeaders(), /INTERNAL_API_TOKEN is required/);
  });
  await withInternalToken('service-secret', async () => {
    assert.deepEqual(
      internalHeaders({ authorization: 'Bearer user', 'content-type': 'text/plain' }),
      {
        authorization: 'Bearer user',
        'content-type': 'application/json',
        'x-polis-internal-token': 'service-secret',
      },
    );
    assert.deepEqual(
      trustedActorHeaders(
        { citizenId: 'citizen-7', identityLevel: 'verified_official' },
        { 'x-polis-citizen': 'spoofed' },
      ),
      {
        'content-type': 'application/json',
        'x-polis-internal-token': 'service-secret',
        'x-polis-citizen': 'citizen-7',
        'x-polis-identity-level': 'verified_official',
      },
    );
  });
});

test('CORS preflight advertises the expanded methods and headers', async () => {
  await withServer([], async (baseUrl) => {
    const response = await fetch(`${baseUrl}/public`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET,POST,DELETE,OPTIONS');
    assert.equal(
      response.headers.get('access-control-allow-headers'),
      'content-type,authorization,idempotency-key',
    );
  });
});

test('deployment profiles preserve dev defaults and reject unsafe pilot configuration', async () => {
  assert.equal(parseDeploymentProfile(undefined), 'dev');
  assert.equal(parseDeploymentProfile('pilot'), 'pilot');
  assert.throws(() => parseDeploymentProfile('production'), /DEPLOYMENT_PROFILE/);
  assert.deepEqual(validateRuntimeConfig({}), {
    deploymentProfile: 'dev',
    internalApiToken: undefined,
    corsAllowedOrigins: ['*'],
  });

  const validPilot = {
    DEPLOYMENT_PROFILE: 'pilot',
    INTERNAL_API_TOKEN: 'a'.repeat(32),
    CORS_ALLOWED_ORIGINS: 'https://polis.example,https://admin.polis.example',
  };
  assert.deepEqual(validateRuntimeConfig(validPilot), {
    deploymentProfile: 'pilot',
    internalApiToken: 'a'.repeat(32),
    corsAllowedOrigins: ['https://polis.example', 'https://admin.polis.example'],
  });

  for (const env of [
    { ...validPilot, INTERNAL_API_TOKEN: undefined },
    { ...validPilot, INTERNAL_API_TOKEN: '   ' },
    { ...validPilot, INTERNAL_API_TOKEN: 'polis-internal-dev-token' },
    { ...validPilot, INTERNAL_API_TOKEN: 'x'.repeat(31) },
  ]) {
    assert.throws(() => validateRuntimeConfig(env), /INTERNAL_API_TOKEN/);
  }
  assert.throws(
    () => validateRuntimeConfig({ ...validPilot, CORS_ALLOWED_ORIGINS: undefined }),
    /CORS_ALLOWED_ORIGINS/,
  );
  assert.throws(
    () => validateRuntimeConfig({ ...validPilot, CORS_ALLOWED_ORIGINS: '*' }),
    /CORS_ALLOWED_ORIGINS/,
  );
  const weakSecret = 'secret-value-to-hide';
  assert.throws(
    () =>
      validateRuntimeConfig({
        ...validPilot,
        INTERNAL_API_TOKEN: weakSecret,
      }),
    (error: unknown) => error instanceof Error && !error.message.includes(weakSecret),
  );

  await withEnvironment(
    {
      DEPLOYMENT_PROFILE: 'pilot',
      INTERNAL_API_TOKEN: undefined,
      CORS_ALLOWED_ORIGINS: 'https://polis.example',
    },
    async () => {
      assert.throws(() => startService('unsafe-pilot', 0, []), /INTERNAL_API_TOKEN/);
    },
  );
});

test('fetchWithTimeout maps its deadline and preserves caller cancellation', async () => {
  const never = once(new EventEmitter(), 'never');
  await withServer(
    [
      {
        method: 'GET',
        path: '/slow',
        handler: () => never,
      },
    ],
    async (baseUrl) => {
      // This integration test intentionally exercises AbortSignal's real platform deadline.
      await assert.rejects(
        fetchWithTimeout(`${baseUrl}/slow`, {}, 10),
        (error: unknown) =>
          error instanceof FetchTimeoutError &&
          error.code === 'FETCH_TIMEOUT' &&
          error.timeoutMs === 10,
      );

      const controller = new AbortController();
      const callerReason = new Error('caller_cancelled');
      controller.abort(callerReason);
      await assert.rejects(
        fetchWithTimeout(`${baseUrl}/slow`, { signal: controller.signal }, 1_000),
        (error: unknown) => error === callerReason,
      );
    },
  );

  await assert.rejects(fetchWithTimeout('http://127.0.0.1', {}, 0), RangeError);
  await assert.rejects(fetchWithTimeout('http://127.0.0.1', {}, 300_001), RangeError);
});

test('readiness reports safe 200/503 state while liveness stays up', async () => {
  const readiness = new ReadinessController();
  await withServer(
    operationalRoutes('runtime-test'),
    async (baseUrl) => {
      const ready = await fetch(`${baseUrl}/readyz`);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { status: 'ready', service: 'runtime-test' });
      assert.match(await (await fetch(`${baseUrl}/metrics`)).text(), /polis_service_ready.* 1/);

      readiness.setNotReady('postgres');
      const unavailable = await fetch(`${baseUrl}/readyz`);
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), {
        status: 'not_ready',
        service: 'runtime-test',
        dependency: 'postgres',
      });
      assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
      const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
      assert.match(metrics, /polis_service_up.* 1/);
      assert.match(metrics, /polis_service_ready.* 0/);

      readiness.setNotReady('secret details with spaces');
      assert.deepEqual(await (await fetch(`${baseUrl}/readyz`)).json(), {
        status: 'not_ready',
        service: 'runtime-test',
        dependency: 'dependency',
      });
    },
    { readiness },
  );
});

test('safe headers and explicit CORS apply to JSON, binary, text, and preflight', async () => {
  await withEnvironment(
    {
      DEPLOYMENT_PROFILE: 'dev',
      CORS_ALLOWED_ORIGINS: 'https://allowed.example,https://admin.example',
    },
    async () => {
      await withServer(
        [
          { method: 'GET', path: '/json', handler: () => ({ ok: true }) },
          {
            method: 'GET',
            path: '/binary',
            handler: () => binaryResult(200, new Uint8Array([1]), 'application/octet-stream'),
          },
          { method: 'GET', path: '/text', handler: () => 'ok' },
        ],
        async (baseUrl) => {
          for (const path of ['/json', '/binary', '/text']) {
            const response = await fetch(`${baseUrl}${path}`, {
              headers: { origin: 'https://allowed.example' },
            });
            assert.equal(
              response.headers.get('access-control-allow-origin'),
              'https://allowed.example',
            );
            assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
            assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
            assert.equal(response.headers.get('cache-control'), 'no-store');
            await response.arrayBuffer();
          }

          const denied = await fetch(`${baseUrl}/json`, {
            headers: { origin: 'https://denied.example' },
          });
          assert.equal(denied.headers.get('access-control-allow-origin'), null);
          assert.equal(denied.headers.get('vary'), 'Origin');

          const preflight = await fetch(`${baseUrl}/json`, {
            method: 'OPTIONS',
            headers: { origin: 'https://allowed.example' },
          });
          assert.equal(preflight.status, 204);
          assert.equal(
            preflight.headers.get('access-control-allow-origin'),
            'https://allowed.example',
          );
          assert.equal(preflight.headers.get('x-content-type-options'), 'nosniff');
        },
      );
    },
  );
});

test('startService applies configured HTTP limits and startup validation', async () => {
  let validated = 0;
  const server = startService('runtime-test', 0, [], {
    requestTimeoutMs: 12_000,
    headersTimeoutMs: 4_000,
    keepAliveTimeoutMs: 2_000,
    maxRequestsPerSocket: 17,
    shutdownGraceMs: 50,
    validateConfig: () => {
      validated += 1;
    },
  });
  try {
    await once(server, 'listening');
    assert.equal(server.requestTimeout, 12_000);
    assert.equal(server.headersTimeout, 4_000);
    assert.equal(server.keepAliveTimeout, 2_000);
    assert.equal(server.maxRequestsPerSocket, 17);
    assert.equal(validated, 1);
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
  assert.throws(
    () => startService('runtime-test', 0, [], { requestTimeoutMs: 0 }),
    /requestTimeoutMs/,
  );
});

test('signal drain is shared, marks readiness down, and force-closes after grace', async () => {
  const originalHandlers = new Set(process.listeners('SIGTERM'));
  const readiness = new ReadinessController();
  const requestState = new EventEmitter();
  const blocked = once(new EventEmitter(), 'never');
  const server = startService(
    'runtime-test',
    0,
    [
      {
        method: 'GET',
        path: '/blocked',
        handler: () => {
          requestState.emit('started');
          return blocked;
        },
      },
    ],
    { readiness, shutdownGraceMs: 25 },
  );
  const secondServer = startService('runtime-test-2', 0, []);
  await Promise.all([once(server, 'listening'), once(secondServer, 'listening')]);

  const addedHandlers = process
    .listeners('SIGTERM')
    .filter((handler) => !originalHandlers.has(handler));
  assert.equal(addedHandlers.length, 1);
  const secondClosed = once(secondServer, 'close');
  secondServer.close();
  await secondClosed;
  assert.equal(
    process.listeners('SIGTERM').filter((handler) => !originalHandlers.has(handler)).length,
    1,
  );

  const address = server.address() as AddressInfo;
  const clientRequest = httpRequest(`http://127.0.0.1:${address.port}/blocked`);
  const started = once(requestState, 'started');
  clientRequest.on('error', () => {});
  clientRequest.end();
  await started;

  // This integration test intentionally waits for the real shutdown grace deadline.

  const closed = once(server, 'close');
  addedHandlers[0]?.('SIGTERM');
  assert.deepEqual(readiness.check(), { ready: false, dependency: 'shutdown' });
  await closed;
  assert.equal(
    process.listeners('SIGTERM').filter((handler) => !originalHandlers.has(handler)).length,
    0,
  );
});

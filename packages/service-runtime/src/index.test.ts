import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import {
  binaryResult,
  internalHeaders,
  operationalRoutes,
  startService,
  trustedActorHeaders,
  versionMeta,
  type Route,
} from './index.js';

async function withServer(routes: Route[], run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = startService('runtime-test', 0, routes);
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
      assert.equal(response.headers.get('content-disposition'), 'attachment; filename="sample.bin"');
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
    assert.deepEqual(internalHeaders({ authorization: 'Bearer user', 'content-type': 'text/plain' }), {
      authorization: 'Bearer user',
      'content-type': 'application/json',
      'x-polis-internal-token': 'service-secret',
    });
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

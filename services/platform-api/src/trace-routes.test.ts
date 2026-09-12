// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { FetchTimeoutError, type Route } from '@polis/service-runtime';

import { platformRoutes } from './routes.js';
import { traceRoutes } from './trace-routes.js';
import { withPublicEdge } from './public-edge.js';

const VALID_IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

type VisibleResult = {
  status: number;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  headers?: Readonly<Record<string, string>>;
};

function request(
  method: string,
  url: string,
  headers: IncomingMessage['headers'] = {},
): IncomingMessage {
  return { method, url, headers } as IncomingMessage;
}

function route(routes: Route[], method: string, path: string): Route {
  const found = routes.find((candidate) => candidate.method === method && candidate.path === path);
  assert.ok(found, `missing route ${method} ${path}`);
  return found;
}

async function withEnvironment(
  values: Readonly<Record<string, string | undefined>>,
  run: () => Promise<void> | void,
): Promise<void> {
  const original = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  ) as Record<string, string | undefined>;
  const originalFetch = globalThis.fetch;
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function result(value: unknown): VisibleResult {
  return value as VisibleResult;
}

const enabledEnvironment = {
  TRACE_ENABLED: 'true',
  TRACE_INTERNAL_URL: 'http://trace.internal',
  INTERNAL_API_TOKEN: 'platform-token',
  IDENTITY_INTERNAL_URL: undefined,
  PUBLIC_EDGE: undefined,
} as const;

test('trace routes are disabled by default and expose only the exact enabled contract', async () => {
  await withEnvironment(
    {
      TRACE_ENABLED: undefined,
      TRACE_INTERNAL_URL: 'http://trace.internal',
      INTERNAL_API_TOKEN: 'platform-token',
    },
    () => {
      assert.deepEqual(traceRoutes(), []);
      assert.equal(
        platformRoutes().some((candidate) => candidate.path.startsWith('/api/trace')),
        false,
      );
    },
  );

  for (const disabledValue of ['', 'false', 'TRUE', '1']) {
    await withEnvironment({ TRACE_ENABLED: disabledValue }, () => {
      assert.deepEqual(traceRoutes(), []);
    });
  }

  await withEnvironment(enabledEnvironment, () => {
    assert.deepEqual(
      traceRoutes().map(({ method, path }) => `${method} ${path}`),
      [
        'GET /api/trace/config',
        'GET /api/trace/session',
        'GET /api/trace/records',
        'POST /api/trace/records',
        'GET /api/trace/records/:id',
        'POST /api/trace/records/:id/assign',
        'POST /api/trace/records/:id/commitment',
        'POST /api/trace/records/:id/review',
        'POST /api/trace/records/:id/resolution',
        'POST /api/trace/records/:id/resolution-review',
        'POST /api/trace/records/:id/attachments',
        'GET /api/trace/records/:id/attachments/:attachmentId',
        'GET /api/trace/public/records',
        'GET /api/trace/public/records/:id',
      ],
    );
    assert.equal(
      route(traceRoutes(), 'POST', '/api/trace/records/:id/attachments').maxBodyBytes,
      2_900_000,
    );
    const paths = platformRoutes().map(({ path }) => path);
    assert.equal(
      paths.some((path) => path.startsWith('/api/v1/trace')),
      false,
    );
    assert.equal(
      paths.some((path) => path.startsWith('/api/traces')),
      false,
    );
  });
});

test('trace rejects browser trusted headers and fails closed on missing configuration', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('{}');
    }) as typeof globalThis.fetch;
    const config = route(traceRoutes(), 'GET', '/api/trace/config');

    for (const headers of [
      { 'x-polis-citizen': 'spoofed' },
      { 'x-polis-identity-level': 'official' },
      { 'x-polis-internal-token': 'spoofed' },
    ]) {
      const response = result(
        await config.handler(request('GET', '/api/trace/config', headers), {}, {}),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, {
        error: 'trusted_headers_forbidden',
        message: 'Trusted identity headers are not accepted from clients.',
      });
    }
    assert.equal(fetchCalls, 0);
  });

  await withEnvironment(
    { TRACE_ENABLED: 'true', TRACE_INTERNAL_URL: undefined, INTERNAL_API_TOKEN: undefined },
    async () => {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('{}');
      }) as typeof globalThis.fetch;
      const config = route(traceRoutes(), 'GET', '/api/trace/config');
      const response = result(await config.handler(request('GET', '/api/trace/config'), {}, {}));
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, {
        error: 'trace_unavailable',
        message: 'Trace service is unavailable.',
      });
      assert.equal(fetchCalls, 0);
    },
  );
});

test('trace normalizes identity outages and upstream failures to safe error objects', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/internal/identity/verify-session')) {
        return new Response('{}', { status: 503 });
      }
      throw new Error('unexpected trace call');
    }) as typeof globalThis.fetch;
    const session = route(traceRoutes(), 'GET', '/api/trace/session');
    const unavailable = result(
      await session.handler(
        request('GET', '/api/trace/session', { authorization: 'Bearer session-token' }),
        {},
        {},
      ),
    );
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.body, {
      error: 'identity_unavailable',
      message: 'Identity verification is unavailable.',
    });

    globalThis.fetch = (async () => {
      throw new FetchTimeoutError(5_000);
    }) as typeof globalThis.fetch;
    const config = route(traceRoutes(), 'GET', '/api/trace/config');
    const timedOut = result(await config.handler(request('GET', '/api/trace/config'), {}, {}));
    assert.equal(timedOut.status, 504);
    assert.deepEqual(timedOut.body, {
      error: 'upstream_timeout',
      message: 'Trace service timed out.',
    });

    globalThis.fetch = (async () => {
      throw new Error('socket failed with private-looking data');
    }) as typeof globalThis.fetch;
    const unavailableTrace = result(
      await config.handler(request('GET', '/api/trace/config'), {}, {}),
    );
    assert.equal(unavailableTrace.status, 502);
    assert.deepEqual(unavailableTrace.body, {
      error: 'bad_gateway',
      message: 'Trace service is unavailable.',
    });
  });
});

test('anonymous trace reads carry only internal auth and preserve bounded list queries', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' },
      });
    }) as typeof globalThis.fetch;

    const routes = traceRoutes();
    await route(routes, 'GET', '/api/trace/config').handler(
      request('GET', '/api/trace/config?limit=99'),
      {},
      {},
    );
    const publicList = await route(routes, 'GET', '/api/trace/public/records').handler(
      request('GET', '/api/trace/public/records?limit=10&token=secret&cursor=not-supported'),
      {},
      {},
    );

    assert.equal(calls[0]?.url, 'http://trace.internal/internal/trace/config');
    assert.equal(calls[1]?.url, 'http://trace.internal/internal/trace/public/records?limit=10');
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get('x-polis-internal-token'), 'platform-token');
      assert.equal(headers.has('x-polis-citizen'), false);
      assert.equal(headers.has('x-polis-identity-level'), false);
      assert.equal(headers.has('authorization'), false);
    }
    assert.equal(result(publicList).status, 200);
    assert.deepEqual(result(publicList).body, { records: [] });
  });
});

test('private trace writes verify sessions, reject authority spoofing, and forward idempotency', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/internal/identity/verify-session')) {
        return new Response(
          JSON.stringify({ citizenId: 'verified-citizen', identityLevel: 'verified_resident' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ record: { id: 'record-1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const create = route(traceRoutes(), 'POST', '/api/trace/records');
    const unauthenticated = result(
      await create.handler(request('POST', '/api/trace/records'), { subject: 'Lamp' }, {}),
    );
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls.length, 0);

    const authHeaders = {
      authorization: 'Bearer browser-session',
      'idempotency-key': VALID_IDEMPOTENCY_KEY,
    };
    const created = await create.handler(
      request('POST', '/api/trace/records', authHeaders),
      { subject: 'Lamp', narrative: 'Dark', location: 'Square' },
      {},
    );
    assert.equal(result(created).status, 201);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'http://localhost:8650/internal/identity/verify-session');
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { sessionToken: 'browser-session' });
    assert.equal(calls[1]?.url, 'http://trace.internal/internal/trace/records');
    const traceHeaders = new Headers(calls[1]?.init?.headers);
    assert.equal(traceHeaders.get('x-polis-internal-token'), 'platform-token');
    assert.equal(traceHeaders.get('x-polis-citizen'), 'verified-citizen');
    assert.equal(traceHeaders.get('x-polis-identity-level'), 'verified_resident');
    assert.equal(traceHeaders.get('idempotency-key'), VALID_IDEMPOTENCY_KEY);
    assert.equal(traceHeaders.has('authorization'), false);

    const callsBeforeSpoof = calls.length;
    const spoofedBody = result(
      await create.handler(
        request('POST', '/api/trace/records', authHeaders),
        {
          subject: 'Lamp',
          actorId: 'browser-actor',
          role: 'official',
          category: 'browser-category',
        },
        {},
      ),
    );
    assert.equal(spoofedBody.status, 400);
    assert.deepEqual(spoofedBody.body, {
      error: 'authority_fields_forbidden',
      message: 'Identity and authority fields are server controlled.',
    });
    assert.equal(calls.length, callsBeforeSpoof + 1);

    const missingKey = result(
      await create.handler(
        request('POST', '/api/trace/records', { authorization: 'Bearer browser-session' }),
        { subject: 'Lamp' },
        {},
      ),
    );
    assert.equal(missingKey.status, 400);
    assert.deepEqual(missingKey.body, {
      error: 'idempotency_key_required',
      message: 'Idempotency-Key is required.',
    });

    const invalidKey = result(
      await create.handler(
        request('POST', '/api/trace/records', {
          authorization: 'Bearer browser-session',
          'idempotency-key': 'not-a-uuid',
        }),
        { subject: 'Lamp' },
        {},
      ),
    );
    assert.equal(invalidKey.status, 400);
    assert.deepEqual(invalidKey.body, {
      error: 'invalid_idempotency_key',
      message: 'Idempotency-Key must be a UUID.',
    });
  });
});

test('trace preserves downstream status, body, and safe content headers', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    let publicCalls = 0;
    globalThis.fetch = (async () => {
      publicCalls += 1;
      return new Response(JSON.stringify({ error: 'stale_version' }), {
        status: 409,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }) as typeof globalThis.fetch;
    const publicRecord = await route(traceRoutes(), 'GET', '/api/trace/public/records/:id').handler(
      request('GET', '/api/trace/public/records/record-1'),
      {},
      { id: 'record-1' },
    );
    assert.equal(publicCalls, 1);
    assert.equal(result(publicRecord).status, 409);
    assert.deepEqual(result(publicRecord).body, {
      error: 'stale_version',
      message: 'Trace request failed.',
    });

    let calls = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls += 1;
      if (String(input).endsWith('/internal/identity/verify-session')) {
        return new Response(
          JSON.stringify({ citizenId: 'verified-citizen', identityLevel: 'verified_resident' }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="evidence.pdf"',
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }) as typeof globalThis.fetch;
    const attachment = await route(
      traceRoutes(),
      'GET',
      '/api/trace/records/:id/attachments/:attachmentId',
    ).handler(
      request('GET', '/api/trace/records/record-1/attachments/file-1', {
        authorization: 'Bearer browser-session',
      }),
      {},
      { id: 'record-1', attachmentId: 'file-1' },
    );
    assert.equal(calls, 2);
    assert.equal(result(attachment).status, 200);
    assert.deepEqual([...result(attachment).bytes!], [1, 2, 3]);
    assert.equal(result(attachment).contentType, 'application/pdf');
    assert.equal(
      result(attachment).headers?.['content-disposition'],
      'attachment; filename="evidence.pdf"',
    );
    assert.equal(result(attachment).headers?.['cache-control'], 'no-store');
  });
});

test('legacy public-edge mode blocks every trace route', async () => {
  await withEnvironment({ ...enabledEnvironment, PUBLIC_EDGE: 'true' }, async () => {
    const wrapped = withPublicEdge(traceRoutes());
    for (const candidate of wrapped) {
      const response = result(
        await candidate.handler(request(candidate.method, candidate.path), {}, {}),
      );
      assert.equal(response.status, 405, `${candidate.method} ${candidate.path}`);
      assert.deepEqual(response.body, { error: 'method_not_allowed', reason: 'public_edge' });
    }
  });
});

test('identity logout uses only the successfully verified Authorization token', async () => {
  await withEnvironment(
    {
      TRACE_ENABLED: undefined,
      IDENTITY_INTERNAL_URL: 'http://identity.internal',
      INTERNAL_API_TOKEN: 'platform-token',
    },
    async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/internal/identity/verify-session')) {
          return new Response(
            JSON.stringify({ citizenId: 'verified-citizen', identityLevel: 'verified_resident' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ revoked: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof globalThis.fetch;

      const routes = platformRoutes();
      const logout = route(routes, 'POST', '/api/v1/identity/logout');
      assert.equal(
        routes.some(
          (candidate) =>
            candidate.method !== 'POST' && candidate.path === '/api/v1/identity/logout',
        ),
        false,
      );

      const unauthenticated = result(
        await logout.handler(request('POST', '/api/v1/identity/logout'), {}, {}),
      );
      assert.equal(unauthenticated.status, 401);
      assert.equal(calls.length, 0);

      const response = result(
        await logout.handler(
          request('POST', '/api/v1/identity/logout?sessionToken=query-spoof', {
            authorization: 'Bearer verified-session',
          }),
          {
            sessionToken: 'body-spoof',
            citizenId: 'browser-citizen',
            role: 'official',
            municipalityId: 'browser-municipality',
          },
          {},
        ),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { revoked: true });
      assert.equal(calls.length, 2);
      assert.equal(calls[0]?.url, 'http://identity.internal/internal/identity/verify-session');
      assert.equal(calls[1]?.url, 'http://identity.internal/internal/identity/logout');
      assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
        sessionToken: 'verified-session',
      });
      assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
        sessionToken: 'verified-session',
      });
      const logoutHeaders = new Headers(calls[1]?.init?.headers);
      assert.equal(logoutHeaders.get('x-polis-internal-token'), 'platform-token');
      assert.equal(logoutHeaders.has('authorization'), false);
      assert.equal(logoutHeaders.has('x-polis-citizen'), false);
    },
  );
});

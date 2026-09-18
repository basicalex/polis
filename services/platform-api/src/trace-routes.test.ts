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
  remoteAddress = '127.0.0.1',
): IncomingMessage {
  return {
    method,
    url,
    headers,
    socket: { remoteAddress },
  } as IncomingMessage;
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
  TRACE_WEB_GATEWAY_ACTOR_ID: 'pilot-web',
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
        'GET /api/trace/officials/me',
        'POST /api/trace/records',
        'GET /api/trace/records/:id',
        'POST /api/trace/records/:id/assign',
        'POST /api/trace/records/:id/commitment',
        'POST /api/trace/records/:id/resolution',
        'POST /api/trace/records/:id/reopen',
        'POST /api/trace/records/:id/hold',
        'POST /api/trace/records/:id/release',
        'POST /api/trace/records/:id/label',
        'POST /api/trace/records/:id/attachments',
        'GET /api/trace/records/:id/attachments/:attachmentId',
        'GET /api/trace/public/records',
        'GET /api/trace/public/records/:id',
        'GET /api/trace/public/cases',
        'GET /api/trace/public/summary',
        'POST /api/trace/public/cases',
        'GET /api/trace/public/cases/:caseNumber',
        'POST /api/trace/public/cases/:caseNumber/attention',
        'POST /api/trace/public/cases/:caseNumber/notice',
        'POST /api/trace/cases/:caseNumber/dispute',
        'POST /api/trace/cases/:caseNumber/erase-text',
        'POST /api/trace/cases/:caseNumber/private',
        'POST /api/trace/cases/:caseNumber/messages',
        'GET /api/trace/records/:id/messages',
        'POST /api/trace/records/:id/messages',
        'POST /api/trace/records/:id/ai-proposals/:proposalId/decision',
        'POST /api/trace/records/:id/close',
      ],
    );
    assert.equal(
      route(traceRoutes(), 'POST', '/api/trace/records/:id/attachments').maxBodyBytes,
      2_900_000,
    );
    assert.equal(route(traceRoutes(), 'POST', '/api/trace/public/cases').maxBodyBytes, 2_900_000);
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
      const url = String(input);
      calls.push({ url, init });
      const body = url.endsWith('/internal/trace/config')
        ? { publicTextMode: 'release', publicTextRetentionDays: 365 }
        : { records: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' },
      });
    }) as typeof globalThis.fetch;

    const routes = traceRoutes();
    const config = await route(routes, 'GET', '/api/trace/config').handler(
      request('GET', '/api/trace/config?limit=99'),
      {},
      {},
    );
    const publicList = await route(routes, 'GET', '/api/trace/public/records').handler(
      request('GET', '/api/trace/public/records?limit=10&token=secret&cursor=not-supported'),
      {},
      {},
    );
    const publicCases = await route(routes, 'GET', '/api/trace/public/cases').handler(
      request(
        'GET',
        '/api/trace/public/cases?limit=25&state=answered&cursor=opaque%2Bcursor&token=secret',
      ),
      {},
      {},
    );

    assert.equal(calls[0]?.url, 'http://trace.internal/internal/trace/config');
    assert.equal(calls[1]?.url, 'http://trace.internal/internal/trace/public/records?limit=10');
    assert.equal(
      calls[2]?.url,
      'http://trace.internal/internal/trace/public/cases?limit=25&state=answered&cursor=opaque%2Bcursor',
    );
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get('x-polis-internal-token'), 'platform-token');
      assert.equal(headers.has('x-polis-citizen'), false);
      assert.equal(headers.has('x-polis-identity-level'), false);
      assert.equal(headers.has('authorization'), false);
    }
    assert.deepEqual(result(config).body, {
      publicTextMode: 'release',
      publicTextRetentionDays: 365,
    });
    assert.equal(result(publicList).status, 200);
    assert.deepEqual(result(publicList).body, { records: [] });
    assert.equal(result(publicCases).status, 200);
  });
});

test('anonymous web case creation injects its gateway principal and shapes the upstream body', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const upstreamBody = {
      case: {
        recordId: 'record-web-1',
        caseNumber: 'VRS-482113',
        reopenKey: 'private-reopen-key',
        state: 'received',
      },
      shell: { caseNumber: 'VRS-482113', state: 'received' },
    };
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(upstreamBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const create = route(traceRoutes(), 'POST', '/api/trace/public/cases');
    const before = Date.now();
    const created = result(
      await create.handler(
        request('POST', '/api/trace/public/cases', {
          'idempotency-key': VALID_IDEMPOTENCY_KEY,
        }),
        { text: 'Ulična rasvjeta ne radi.', location: 'Vrsar' },
        {},
      ),
    );
    const after = Date.now();

    assert.equal(created.status, 201);
    assert.deepEqual(created.body, upstreamBody);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://trace.internal/internal/trace/channel/cases');
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.get('x-polis-internal-token'), 'platform-token');
    assert.equal(headers.get('x-polis-trace-gateway'), 'pilot-web');
    assert.equal(headers.get('idempotency-key'), VALID_IDEMPOTENCY_KEY);
    assert.equal(headers.has('x-polis-citizen'), false);
    assert.equal(headers.has('authorization'), false);
    const shaped = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    assert.deepEqual(
      { ...shaped, occurredAt: '<server-time>' },
      {
        channel: 'web',
        text: 'Ulična rasvjeta ne radi.',
        location: 'Vrsar',
        source: 'typed',
        occurredAt: '<server-time>',
      },
    );
    const occurredAt = Date.parse(String(shaped.occurredAt));
    assert.ok(occurredAt >= before && occurredAt <= after);

    for (const field of ['category', 'office', 'municipality', 'channel', 'source', 'occurredAt']) {
      const rejected = result(
        await create.handler(
          request('POST', '/api/trace/public/cases', {
            'idempotency-key': VALID_IDEMPOTENCY_KEY,
          }),
          { text: 'Prijava', [field]: 'browser-controlled' },
          {},
        ),
      );
      assert.equal(rejected.status, 400, field);
    }
    assert.equal(calls.length, 1);
  });
});

test('anonymous web case creation maps bounded photos and rejects invalid photo input', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ accepted: true }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;
    const create = route(traceRoutes(), 'POST', '/api/trace/public/cases');
    const photos = [
      {
        contentType: 'image/jpeg',
        base64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
        filename: 'photo.jpg',
      },
      {
        contentType: 'image/png',
        base64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
        filename: 'photo.png',
      },
    ] as const;
    for (const photo of photos) {
      const response = result(
        await create.handler(
          request('POST', '/api/trace/public/cases', {
            'idempotency-key': VALID_IDEMPOTENCY_KEY,
          }),
          { text: 'Prijava', photo: { contentType: photo.contentType, base64: photo.base64 } },
          {},
        ),
      );
      assert.equal(response.status, 201);
      const shaped = JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>;
      assert.deepEqual(shaped.attachment, {
        filename: photo.filename,
        contentType: photo.contentType,
        base64: photo.base64,
      });
    }

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
    for (const photo of [
      { contentType: 'image/jpeg', base64: photos[0].base64, extra: true },
      { contentType: 'image/gif', base64: 'R0lGODlh' },
      { contentType: 'image/jpeg', base64: oversized },
      { contentType: 'image/jpeg', base64: 'not-base64' },
    ]) {
      const response = result(
        await create.handler(
          request('POST', '/api/trace/public/cases', {
            'idempotency-key': VALID_IDEMPOTENCY_KEY,
          }),
          { text: 'Prijava', photo },
          {},
        ),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, {
        error: 'invalid_request',
        message: 'photo is invalid.',
      });
    }
    assert.equal(calls.length, photos.length);
  });
});

test('anonymous web case creation fails closed without its gateway principal', async () => {
  await withEnvironment(
    { ...enabledEnvironment, TRACE_WEB_GATEWAY_ACTOR_ID: undefined },
    async () => {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response('{}');
      }) as typeof globalThis.fetch;
      const create = route(traceRoutes(), 'POST', '/api/trace/public/cases');
      const response = result(
        await create.handler(
          request('POST', '/api/trace/public/cases', {
            'idempotency-key': VALID_IDEMPOTENCY_KEY,
          }),
          { text: 'Prijava' },
          {},
        ),
      );
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, {
        error: 'trace_unavailable',
        message: 'Trace service is unavailable.',
      });
      assert.equal(fetchCalls, 0);
    },
  );
});

test('reopen-key and public case routes proxy without browser actor headers', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const routes = traceRoutes();
    await route(routes, 'GET', '/api/trace/public/cases').handler(
      request('GET', '/api/trace/public/cases?limit=5&token=secret'),
      {},
      {},
    );
    await route(routes, 'POST', '/api/trace/cases/:caseNumber/private').handler(
      request('POST', '/api/trace/cases/VRS-1842/private'),
      { reopenKey: 'body-only-secret' },
      { caseNumber: 'VRS-1842' },
    );
    await route(routes, 'POST', '/api/trace/cases/:caseNumber/messages').handler(
      request('POST', '/api/trace/cases/VRS-1842/messages', {
        'idempotency-key': VALID_IDEMPOTENCY_KEY,
      }),
      { reopenKey: 'body-only-secret', body: 'More detail.' },
      { caseNumber: 'VRS-1842' },
    );
    await route(routes, 'POST', '/api/trace/public/cases/:caseNumber/attention').handler(
      request('POST', '/api/trace/public/cases/VRS-1842/attention', {
        'idempotency-key': VALID_IDEMPOTENCY_KEY,
      }),
      { followerKey: 'follower-secret', kind: 'follow', action: 'add' },
      { caseNumber: 'VRS-1842' },
    );
    await route(routes, 'POST', '/api/trace/public/cases/:caseNumber/notice').handler(
      request('POST', '/api/trace/public/cases/VRS-1842/notice', {
        'idempotency-key': VALID_IDEMPOTENCY_KEY,
      }),
      { followerKey: 'follower-secret', reason: 'abuse', note: 'Contains personal details.' },
      { caseNumber: 'VRS-1842' },
    );
    await route(routes, 'POST', '/api/trace/cases/:caseNumber/dispute').handler(
      request('POST', '/api/trace/cases/VRS-1842/dispute', {
        'idempotency-key': VALID_IDEMPOTENCY_KEY,
      }),
      { reopenKey: 'body-only-secret', text: 'The lamp is still dark.' },
      { caseNumber: 'VRS-1842' },
    );
    await route(routes, 'POST', '/api/trace/cases/:caseNumber/erase-text').handler(
      request('POST', '/api/trace/cases/VRS-1842/erase-text', {
        'idempotency-key': VALID_IDEMPOTENCY_KEY,
      }),
      { reopenKey: 'body-only-secret' },
      { caseNumber: 'VRS-1842' },
    );

    assert.deepEqual(
      calls.map(({ url }) => url),
      [
        'http://trace.internal/internal/trace/public/cases?limit=5',
        'http://trace.internal/internal/trace/cases/VRS-1842/private',
        'http://trace.internal/internal/trace/cases/VRS-1842/messages',
        'http://trace.internal/internal/trace/public/cases/VRS-1842/attention',
        'http://trace.internal/internal/trace/public/cases/VRS-1842/notice',
        'http://trace.internal/internal/trace/cases/VRS-1842/dispute',
        'http://trace.internal/internal/trace/cases/VRS-1842/erase-text',
      ],
    );
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get('x-polis-internal-token'), 'platform-token');
      assert.equal(headers.has('x-polis-citizen'), false);
      assert.equal(headers.has('x-polis-identity-level'), false);
      assert.equal(headers.has('authorization'), false);
    }
    assert.equal(new Headers(calls[1]?.init?.headers).has('idempotency-key'), false);
    for (const call of calls.slice(2)) {
      assert.equal(new Headers(call.init?.headers).get('idempotency-key'), VALID_IDEMPOTENCY_KEY);
    }
    assert.deepEqual(JSON.parse(String(calls[4]?.init?.body)), {
      followerKey: 'follower-secret',
      reason: 'abuse',
      note: 'Contains personal details.',
    });
    assert.deepEqual(JSON.parse(String(calls[6]?.init?.body)), {
      reopenKey: 'body-only-secret',
    });
  });
});

test('new staff case routes require a verified session and trusted actor forwarding', async () => {
  await withEnvironment(enabledEnvironment, async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls += 1;
      if (String(input).endsWith('/internal/identity/verify-session')) {
        return new Response(
          JSON.stringify({ citizenId: 'verified-official', identityLevel: 'verified_resident' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-polis-citizen'), 'verified-official');
      assert.equal(headers.get('x-polis-identity-level'), 'verified_resident');
      assert.equal(headers.has('authorization'), false);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const routes = traceRoutes();
    const privateRoutes = [
      ['GET', '/api/trace/records/:id/messages'],
      ['POST', '/api/trace/records/:id/messages'],
      ['POST', '/api/trace/records/:id/ai-proposals/:proposalId/decision'],
      ['POST', '/api/trace/records/:id/close'],
      ['POST', '/api/trace/records/:id/reopen'],
      ['POST', '/api/trace/records/:id/hold'],
      ['POST', '/api/trace/records/:id/release'],
      ['POST', '/api/trace/records/:id/label'],
    ] as const;
    for (const [method, path] of privateRoutes) {
      const response = result(
        await route(routes, method, path).handler(
          request(
            method,
            path,
            method === 'POST' ? { 'idempotency-key': VALID_IDEMPOTENCY_KEY } : {},
          ),
          {},
          { id: 'record-1', proposalId: 'proposal-1' },
        ),
      );
      assert.equal(response.status, 401, `${method} ${path}`);
    }
    assert.equal(fetchCalls, 0);

    const close = route(routes, 'POST', '/api/trace/records/:id/close');
    const response = result(
      await close.handler(
        request('POST', '/api/trace/records/record-1/close', {
          authorization: 'Bearer browser-session',
          'idempotency-key': VALID_IDEMPOTENCY_KEY,
        }),
        { expectedVersion: 0, reason: 'out-of-scope', publicReason: 'Not in pilot.' },
        { id: 'record-1' },
      ),
    );
    assert.equal(response.status, 200);
    assert.equal(fetchCalls, 2);
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
    for (const [error, message] of [
      ['release_not_permitted', 'Text release is not permitted.'],
      ['text_removed', 'Public text has been removed.'],
    ] as const) {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })) as typeof globalThis.fetch;
      const response = result(
        await route(traceRoutes(), 'GET', '/api/trace/public/records/:id').handler(
          request('GET', '/api/trace/public/records/record-1'),
          {},
          { id: 'record-1' },
        ),
      );
      assert.equal(response.status, 409);
      assert.deepEqual(response.body, { error, message });
    }

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

test('public trace routes enforce their per-IP limits with and without public-edge mode', async () => {
  for (const publicEdge of [undefined, 'true'] as const) {
    await withEnvironment({ ...enabledEnvironment, PUBLIC_EDGE: publicEdge }, async () => {
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof globalThis.fetch;

      const routes = publicEdge ? withPublicEdge(traceRoutes()) : traceRoutes();
      const limited = [
        {
          path: '/api/trace/public/cases',
          url: '/api/trace/public/cases',
          body: { text: 'Streetlight is dark.' },
          params: {},
          limit: 5,
        },
        {
          path: '/api/trace/public/cases/:caseNumber/attention',
          url: '/api/trace/public/cases/VRS-1842/attention',
          body: { followerKey: 'follower-key', kind: 'not-fixed', action: 'add' },
          params: { caseNumber: 'VRS-1842' },
          limit: 30,
        },
        {
          path: '/api/trace/public/cases/:caseNumber/notice',
          url: '/api/trace/public/cases/VRS-1842/notice',
          body: { followerKey: 'follower-key', reason: 'personal-data', note: 'Name included.' },
          params: { caseNumber: 'VRS-1842' },
          limit: 10,
        },
        {
          path: '/api/trace/cases/:caseNumber/dispute',
          url: '/api/trace/cases/VRS-1842/dispute',
          body: { reopenKey: 'reopen-key', text: 'The problem remains.' },
          params: { caseNumber: 'VRS-1842' },
          limit: 5,
        },
        {
          path: '/api/trace/cases/:caseNumber/erase-text',
          url: '/api/trace/cases/VRS-1842/erase-text',
          body: { reopenKey: 'reopen-key' },
          params: { caseNumber: 'VRS-1842' },
          limit: 5,
        },
      ] as const;

      for (const spec of limited) {
        const target = route(routes, 'POST', spec.path);
        for (let index = 0; index < spec.limit; index += 1) {
          const response = result(
            await target.handler(
              request(
                'POST',
                spec.url,
                { 'idempotency-key': VALID_IDEMPOTENCY_KEY },
                `rate-${publicEdge ?? 'default'}-${spec.path}`,
              ),
              spec.body,
              spec.params,
            ),
          );
          assert.equal(
            response.status,
            200,
            `${publicEdge ?? 'default'} ${spec.path} request ${index + 1}`,
          );
        }
        const blocked = result(
          await target.handler(
            request(
              'POST',
              spec.url,
              { 'idempotency-key': VALID_IDEMPOTENCY_KEY },
              `rate-${publicEdge ?? 'default'}-${spec.path}`,
            ),
            spec.body,
            spec.params,
          ),
        );
        assert.equal(blocked.status, 429, `${publicEdge ?? 'default'} ${spec.path}`);
        assert.deepEqual(blocked.body, {
          error: 'rate_limited',
          message: 'Too many requests.',
        });
      }

      const summary = route(routes, 'GET', '/api/trace/public/summary');
      const summaryAddress = `summary-${publicEdge ?? 'default'}`;
      for (let index = 0; index < 30; index += 1) {
        const response = result(
          await summary.handler(
            request('GET', '/api/trace/public/summary', {}, summaryAddress),
            {},
            {},
          ),
        );
        assert.equal(response.status, 200);
      }
      const blockedSummary = result(
        await summary.handler(
          request('GET', '/api/trace/public/summary', {}, summaryAddress),
          {},
          {},
        ),
      );
      assert.equal(blockedSummary.status, 429);
      assert.deepEqual(blockedSummary.body, {
        error: 'rate_limited',
        message: 'Too many requests.',
      });

      assert.equal(fetchCalls, 85);
    });
  }
});

test('public-edge mode blocks unlisted private trace routes and unknown methods', async () => {
  await withEnvironment({ ...enabledEnvironment, PUBLIC_EDGE: 'true' }, async () => {
    const unknownMethodRoutes: Route[] = [
      {
        method: 'GET',
        path: '/api/trace/public/cases/:caseNumber/notice',
        handler: () => {
          throw new Error('unknown method handler must not run');
        },
      },
      {
        method: 'GET',
        path: '/api/trace/cases/:caseNumber/erase-text',
        handler: () => {
          throw new Error('unknown method handler must not run');
        },
      },
    ];
    const routes = withPublicEdge([...traceRoutes(), ...unknownMethodRoutes]);
    const privateRoute = route(routes, 'GET', '/api/trace/records');
    const response = result(await privateRoute.handler(request('GET', privateRoute.path), {}, {}));
    assert.equal(response.status, 405);
    assert.deepEqual(response.body, { error: 'method_not_allowed', reason: 'public_edge' });
    const official = result(
      await route(routes, 'GET', '/api/trace/officials/me').handler(
        request('GET', '/api/trace/officials/me'),
        {},
        {},
      ),
    );
    assert.equal(official.status, 401);
    assert.deepEqual(official.body, {
      error: 'unauthenticated',
      message: 'Sign in is required.',
    });
    for (const unknown of unknownMethodRoutes) {
      const blocked = result(
        await route(routes, unknown.method, unknown.path).handler(
          request(unknown.method, unknown.path),
          {},
          { caseNumber: 'VRS-1842' },
        ),
      );
      assert.equal(blocked.status, 405);
      assert.deepEqual(blocked.body, { error: 'method_not_allowed', reason: 'public_edge' });
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

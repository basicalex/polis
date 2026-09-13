// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { FetchTimeoutError, type Route } from '@polis/service-runtime';

import { channelRoutes } from './channel-routes.js';
import { withPublicEdge } from './public-edge.js';
import { platformRoutes } from './routes.js';

type VisibleResult = {
  status: number;
  body?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
};

function request(headers: IncomingMessage['headers'] = {}): IncomingMessage {
  return { method: 'POST', url: '/webhooks/infobip/calls', headers } as IncomingMessage;
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

function visible(value: unknown): VisibleResult {
  return value as VisibleResult;
}

function fetchHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

test('channelRoutes are disabled by default and expose the three enabled Infobip routes', async () => {
  await withEnvironment(
    { CHANNEL_ENABLED: undefined, CHANNEL_INTERNAL_URL: 'http://channel.internal' },
    () => {
      assert.deepEqual(channelRoutes(), []);
      assert.equal(
        platformRoutes().some((candidate) => candidate.path.startsWith('/webhooks/infobip/')),
        false,
      );
    },
  );
  await withEnvironment({ CHANNEL_ENABLED: 'true' }, () => {
    assert.deepEqual(
      channelRoutes().map(
        ({ method, path, bodyMode, maxBodyBytes }) =>
          `${method} ${path} bodyMode=${bodyMode} maxBodyBytes=${maxBodyBytes}`,
      ),
      [
        'POST /webhooks/infobip/sms bodyMode=raw maxBodyBytes=65536',
        'POST /webhooks/infobip/sms-reports bodyMode=raw maxBodyBytes=65536',
        'POST /webhooks/infobip/calls bodyMode=raw maxBodyBytes=65536',
      ],
    );
  });
});

test('Infobip webhooks forward raw bytes and only the configured signature client header', async () => {
  await withEnvironment(
    {
      CHANNEL_ENABLED: 'true',
      CHANNEL_INTERNAL_URL: 'http://channel.internal/',
      INTERNAL_API_TOKEN: 'platform-token',
      INFOBIP_WEBHOOK_SIGNATURE_HEADER: 'x-hub-signature',
    },
    async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const upstreamBytes = new Uint8Array([9, 8, 7]);
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(upstreamBytes, {
          status: 202,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }) as typeof globalThis.fetch;
      const body = new Uint8Array([1, 2, 3, 4]);
      const response = visible(
        await route(channelRoutes(), 'POST', '/webhooks/infobip/calls').handler(
          request({
            'x-hub-signature': 'sha256=abc',
            'x-polis-citizen': 'spoofed',
            'x-polis-internal-token': 'spoofed-token',
          }),
          body,
          {},
        ),
      );
      assert.equal(
        calls[0]?.url,
        'http://channel.internal/internal/channel/webhooks/infobip/calls',
      );
      assert.deepEqual(
        new Uint8Array(await new Response(calls[0]?.init?.body).arrayBuffer()),
        body,
      );
      assert.equal(fetchHeader(calls[0]?.init?.headers, 'x-hub-signature'), 'sha256=abc');
      assert.equal(
        fetchHeader(calls[0]?.init?.headers, 'x-polis-internal-token'),
        'platform-token',
      );
      assert.notEqual(
        fetchHeader(calls[0]?.init?.headers, 'x-polis-internal-token'),
        'spoofed-token',
      );
      assert.equal(fetchHeader(calls[0]?.init?.headers, 'x-polis-citizen'), null);
      assert.equal(response.status, 202);
      assert.equal(response.contentType, 'application/octet-stream');
      assert.deepEqual(response.bytes, upstreamBytes);
    },
  );
});

test('all Infobip webhook routes use 1500 ms and map transport failures', async () => {
  await withEnvironment(
    { CHANNEL_ENABLED: 'true', INTERNAL_API_TOKEN: 'platform-token' },
    async () => {
      const timeouts: number[] = [];
      const originalTimeout = AbortSignal.timeout;
      AbortSignal.timeout = ((timeoutMs: number) => {
        timeouts.push(timeoutMs);
        return originalTimeout(timeoutMs);
      }) as typeof AbortSignal.timeout;
      try {
        globalThis.fetch = (async () =>
          new Response(new Uint8Array(), { status: 204 })) as typeof globalThis.fetch;
        for (const candidate of channelRoutes()) {
          await candidate.handler(request(), new Uint8Array(), {});
        }
        assert.deepEqual(timeouts, [1500, 1500, 1500]);
      } finally {
        AbortSignal.timeout = originalTimeout;
      }
      globalThis.fetch = (async () => {
        throw new FetchTimeoutError(1500);
      }) as typeof globalThis.fetch;
      let response = visible(
        await route(channelRoutes(), 'POST', '/webhooks/infobip/calls').handler(
          request(),
          new Uint8Array(),
          {},
        ),
      );
      assert.equal(response.status, 504);
      assert.deepEqual(response.body, { error: 'upstream_timeout' });
      globalThis.fetch = (async () => {
        throw new Error('connection refused');
      }) as typeof globalThis.fetch;
      response = visible(
        await route(channelRoutes(), 'POST', '/webhooks/infobip/calls').handler(
          request(),
          new Uint8Array(),
          {},
        ),
      );
      assert.equal(response.status, 502);
      assert.deepEqual(response.body, { error: 'bad_gateway' });
    },
  );
});

test('public-edge blocks channel Infobip webhook routes', async () => {
  await withEnvironment({ CHANNEL_ENABLED: 'true', PUBLIC_EDGE: 'true' }, async () => {
    for (const candidate of withPublicEdge(channelRoutes())) {
      const response = visible(await candidate.handler(request(), new Uint8Array(), {}));
      assert.equal(response.status, 405, `${candidate.method} ${candidate.path}`);
      assert.deepEqual(response.body, { error: 'method_not_allowed', reason: 'public_edge' });
    }
  });
});

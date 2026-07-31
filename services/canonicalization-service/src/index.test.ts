import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { canonicalizationRoutes, canonicalize } from './index.js';
import { startService, type Route } from '@polis/service-runtime';

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

async function withServer(routes: Route[], run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = startService('canonicalization-service', 0, routes);
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

const b64 = (s: string) => Buffer.from(s).toString('base64');

test('canonicalization-service exposes §9.11 canonicalize route', () => {
  const paths = canonicalizationRoutes().map((r) => `${r.method} ${r.path}`);
  assert.ok(paths.includes('POST /internal/canonicalization/canonicalize'));
});

test('same content yields the same hash bundle', async () => {
  const a = await canonicalize(b64('same bytes'), { foo: 1 });
  const b = await canonicalize(b64('same bytes'), { foo: 1 });
  assert.deepEqual(a, b);
  assert.equal(a.algorithm, 'sha256');
  assert.equal(a.canonicalPdfHash, a.originalFileHash);
});

test('manifestHash is deterministic across calls', async () => {
  const a = await canonicalize(b64('deterministic'), null);
  const b = await canonicalize(b64('deterministic'), null);
  assert.equal(a.manifestHash, b.manifestHash);
});

test('different content yields a different originalFileHash', async () => {
  const a = await canonicalize(b64('content-a'), null);
  const b = await canonicalize(b64('content-b'), null);
  assert.notEqual(a.originalFileHash, b.originalFileHash);
  assert.notEqual(a.manifestHash, b.manifestHash);
});

test('canonicalization-service rejects unauthenticated internal canonicalize requests', async () => {
  await withInternalToken('canonicalization-test-token', async () => {
    await withServer(canonicalizationRoutes(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/canonicalization/canonicalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: 'internal_auth_required',
        service: 'canonicalization-service',
      });
    });
  });
});

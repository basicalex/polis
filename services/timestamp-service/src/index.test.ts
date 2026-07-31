import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { startService } from '@polis/service-runtime';
import { timestampRoutes } from './index.js';
import {
  StubTimestampClient,
  Rfc3161TimestampClient,
  createTimestampClient,
} from './timestamp-client.js';
async function withTimestampServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = 'timestamp-test-token';
  const server = startService('timestamp-service', 0, timestampRoutes({} as never, {} as never));
  try {
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
  }
}


test('timestamp-service exposes §9.14 timestamp routes', () => {
  const paths = timestampRoutes({} as never, {} as never).map((r) => `${r.method} ${r.path}`);
  for (const p of [
    'POST /internal/timestamps',
    'GET /internal/timestamps/:proofId',
    'GET /healthz',
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
});
test('timestamp-service rejects unauthenticated internal HTTP access', async () => {
  await withTimestampServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/timestamps/proof-1`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'internal_auth_required',
      service: 'timestamp-service',
    });
  });
});


// ── createTimestampClient mode resolution ─────────────────────────────────
// Env is saved/restored around every case so the suite is order-independent.

test('createTimestampClient defaults to stub when TIMESTAMP_MODE is unset', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  delete process.env.TIMESTAMP_MODE;
  try {
    assert.ok(createTimestampClient() instanceof StubTimestampClient);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
  }
});

test('createTimestampClient resolves TIMESTAMP_MODE=stub to StubTimestampClient', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  process.env.TIMESTAMP_MODE = 'stub';
  try {
    assert.ok(createTimestampClient() instanceof StubTimestampClient);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
  }
});

test('Rfc3161TimestampClient ctor requires TSA_URL in real mode', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  const savedUrl = process.env.TSA_URL;
  process.env.TIMESTAMP_MODE = 'real';
  delete process.env.TSA_URL;
  try {
    // Env validated at construction — fails before any network call.
    assert.throws(() => createTimestampClient(), /TSA_URL/);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
    if (savedUrl !== undefined) process.env.TSA_URL = savedUrl;
    else delete process.env.TSA_URL;
  }
});

test('createTimestampClient resolves TIMESTAMP_MODE=real to Rfc3161TimestampClient when TSA_URL is set', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  const savedUrl = process.env.TSA_URL;
  process.env.TIMESTAMP_MODE = 'real';
  process.env.TSA_URL = 'http://tsa:3000/api/v1/timestamp';
  try {
    // ctor validates env and stores fields — no network is touched.
    assert.ok(createTimestampClient() instanceof Rfc3161TimestampClient);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
    if (savedUrl !== undefined) process.env.TSA_URL = savedUrl;
    else delete process.env.TSA_URL;
  }
});

test('createTimestampClient throws on an unsupported mode', () => {
  const savedMode = process.env.TIMESTAMP_MODE;
  process.env.TIMESTAMP_MODE = 'bad';
  try {
    assert.throws(() => createTimestampClient(), /not supported/);
  } finally {
    if (savedMode !== undefined) process.env.TIMESTAMP_MODE = savedMode;
    else delete process.env.TIMESTAMP_MODE;
  }
});

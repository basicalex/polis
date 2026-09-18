// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test';
import assert from 'node:assert/strict';

import { handlePilotProxy } from '../src/lib/pilot/vrsar/proxy.ts';

const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

function proxyContext(path, {
  method = 'GET',
  query = '',
  body,
  cookie,
  clientIp,
} = {}) {
  const origin = 'http://localhost:4321';
  const headers = new Headers();
  if (method === 'POST') headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  if (clientIp) headers.set('cf-connecting-ip', clientIp);
  if (method === 'POST') headers.set('idempotency-key', IDEMPOTENCY_KEY);
  return {
    request: new Request(`${origin}/pilot/vrsar/api/${path}${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url: new URL(`${origin}/pilot/vrsar/api/${path}${query}`),
    params: { path },
  };
}

function jsonResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('Worker proxy forwards paired edge headers, exact paging queries, and new reads', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse();
  };
  const options = {
    publicRelease: false,
    backendBase: 'https://trace.internal',
    edgeKey: 'worker-edge-secret',
    fetchImpl,
  };

  await handlePilotProxy(proxyContext('public/cases', {
    clientIp: '203.0.113.24',
    query: '?limit=25&state=answered&cursor=opaque%2Bcursor&ignored=drop',
  }), options);
  await handlePilotProxy(proxyContext('public/summary', {
    clientIp: '2001:db8::24',
  }), options);
  await handlePilotProxy(proxyContext('officials/me', {
    cookie: 'polis_pilot_session=official-session',
    clientIp: '203.0.113.25',
  }), options);

  assert.equal(
    calls[0].url,
    'https://trace.internal/api/trace/public/cases?limit=25&state=answered&cursor=opaque%2Bcursor',
  );
  assert.equal(calls[1].url, 'https://trace.internal/api/trace/public/summary');
  assert.equal(calls[2].url, 'https://trace.internal/api/trace/officials/me');
  assert.equal(calls[2].init.headers.get('authorization'), 'Bearer official-session');
  assert.equal(calls[0].init.headers.get('x-polis-edge-key'), 'worker-edge-secret');
  assert.equal(calls[0].init.headers.get('x-polis-client-ip'), '203.0.113.24');

  await handlePilotProxy(proxyContext('config', {
    clientIp: '198.51.100.9',
  }), { ...options, edgeKey: undefined });
  assert.equal(calls[3].init.headers.get('x-polis-edge-key'), null);
  assert.equal(calls[3].init.headers.get('x-polis-client-ip'), null);
});

test('Worker proxy accepts assignment units and rejects browser commitment signers', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse();
  };
  const options = { publicRelease: false, backendBase: 'https://trace.internal', fetchImpl };
  const authenticated = { cookie: 'polis_pilot_session=server-token' };

  const assigned = await handlePilotProxy(proxyContext('records/record-1/assign', {
    ...authenticated,
    method: 'POST',
    body: { expectedVersion: 2, unitId: 'communal-system' },
  }), options);
  assert.equal(assigned.status, 200);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    expectedVersion: 2,
    unitId: 'communal-system',
  });

  const rejected = await handlePilotProxy(proxyContext('records/record-1/commitment', {
    ...authenticated,
    method: 'POST',
    body: {
      expectedVersion: 3,
      commitment: 'Replace the lamp.',
      dueDate: '2026-10-01',
      signedBy: { name: 'Browser supplied', title: 'Browser supplied' },
    },
  }), options);
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 1);

  const accepted = await handlePilotProxy(proxyContext('records/record-1/commitment', {
    ...authenticated,
    method: 'POST',
    body: {
      expectedVersion: 3,
      commitment: 'Replace the lamp.',
      dueDate: '2026-10-01',
    },
  }), options);
  assert.equal(accepted.status, 200);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    expectedVersion: 3,
    commitment: 'Replace the lamp.',
    dueDate: '2026-10-01',
  });
});

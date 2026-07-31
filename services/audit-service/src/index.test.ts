import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditRoutes,
  buildCanonicalAuditEvent,
  canonicalAuditJson,
  computeAuditHash,
} from './index.js';
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
  const server = startService('audit-service', 0, routes);
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

test('computeAuditHash hashes previous hash plus canonical event JSON', () => {
  const canonicalJson =
    '{"action":"seeded","actorId":"seed-script","actorType":"service","correlationId":"corr-1","createdAt":"2026-06-19T00:00:00.000Z","data":{"a":{"alpha":"first","beta":true},"z":1},"eventType":"graph.entity.created","reason":"phase-1-seed","redactedData":{"public":true},"targetId":"inst-complaints-office","targetType":"institution","visibility":"public"}';
  const expected = createHash('sha256').update(`abc123${canonicalJson}`).digest('hex');

  assert.equal(computeAuditHash('abc123', canonicalJson), expected);
});

test('buildCanonicalAuditEvent normalizes nullable fields and stable JSON', () => {
  const canonical = buildCanonicalAuditEvent({
    eventType: 'audit.event.created',
    actorType: 'service',
    actorId: 'audit-service',
    action: 'append',
    visibility: 'public',
    data: { z: 1, a: 2 },
    createdAt: '2026-06-19T00:00:00.000Z',
  });

  assert.equal(
    canonicalAuditJson(canonical),
    '{"action":"append","actorId":"audit-service","actorType":"service","correlationId":null,"createdAt":"2026-06-19T00:00:00.000Z","data":{"a":2,"z":1},"eventType":"audit.event.created","reason":null,"redactedData":null,"targetId":null,"targetType":null,"visibility":"public"}',
  );
});

test('auditRoutes exposes append and public target read paths', () => {
  const paths = auditRoutes({} as never).map((route) => `${route.method} ${route.path}`);

  assert.ok(paths.includes('POST /internal/audit/events'));
  assert.ok(paths.includes('GET /api/v1/audit/:objectType/:objectId'));
});

test('audit-service rejects unauthenticated internal audit event requests', async () => {
  await withInternalToken('audit-test-token', async () => {
    await withServer(auditRoutes({} as never), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: 'internal_auth_required',
        service: 'audit-service',
      });
    });
  });
});

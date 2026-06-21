/**
 * @polis/timestamp-service — §9.14 RFC 3161 timestamp issuer.
 *
 * Owns the proof_timestamps table. Mints hash timestamps (§15.6: timestamps
 * hash, not documents) and exposes the internal timestamp-create + read
 * contract used by proof-service orchestration. Not proxied through the
 * public BFF — internal-only, like paperless-adapter.
 *
 * Routes are bound to a {@link TimestampClient} so the stub and the future
 * HTTP adapter share one contract. Audit events are emitted best-effort to
 * the audit-service internal endpoint.
 */
import { getClient } from '@polis/db';
import type { DbClient } from '@polis/db';
import { eq, sql } from 'drizzle-orm';
import { operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

import { schema } from '@polis/db';
import { createTimestampClient, type TimestampClient } from './timestamp-client.js';
import { proofTimestampWire } from './serialize.js';

/**
 * Best-effort audit emit. Failures (audit-service unreachable) are logged and
 * never fail the originating request — matches proof-service + polis-bridge.
 */
async function emitAudit(event: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetch(base + '/internal/audit/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: 'public',
        actor: { type: 'service', id: 'timestamp-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'timestamp-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Build the §9.14 route table bound to a DB client + timestamp adapter. */
export function timestampRoutes(db: DbClient, client: TimestampClient): Route[] {
  return [
    ...operationalRoutes('timestamp-service'),

    // §9.14 — request an RFC 3161 timestamp for a manifest hash.
    {
      method: 'POST',
      path: '/internal/timestamps',
      handler: async (_req, body) => {
        const input = body as { proofId?: string; hash?: string; algorithm?: string };
        if (!input.proofId || !input.hash) {
          return result(400, { error: 'missing_required_fields' });
        }
        const stamped = await client.requestTimestamp({
          proofId: input.proofId,
          hash: input.hash,
          algorithm: input.algorithm,
        });
        const inserted = await db
          .insert(schema.proofTimestamps)
          .values({
            id: sql`gen_random_uuid()::text`,
            proofId: input.proofId,
            type: stamped.type,
            timestampRef: stamped.timestampRef,
            timestampedHash: stamped.timestampedHash,
            timestampedAt: new Date(stamped.timestampedAt),
            validationStatus: stamped.validationStatus,
            tsa: stamped.tsa,
            clockSource: stamped.clockSource,
          })
          .returning();
        const row = inserted[0];
        await emitAudit({
          eventType: 'proof.timestamp.created',
          action: 'create',
          target: { type: 'proof', id: input.proofId },
          data: { timestampId: row.id, tsa: stamped.tsa, type: stamped.type },
        });
        return result(201, proofTimestampWire(row));
      },
    },

    // §9.14 — list timestamps for a proof (oldest → newest).
    {
      method: 'GET',
      path: '/internal/timestamps/:proofId',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.proofTimestamps)
          .where(eq(schema.proofTimestamps.proofId, params.proofId))
          .orderBy(schema.proofTimestamps.createdAt);
        return { items: rows.map(proofTimestampWire) };
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.TIMESTAMP_SERVICE_PORT ?? 8800);
  const client = createTimestampClient();
  const db = getClient();
  startService('timestamp-service', port, timestampRoutes(db, client));
  console.log(JSON.stringify({ service: 'timestamp-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

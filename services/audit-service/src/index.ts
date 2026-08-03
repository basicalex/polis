/**
 * @polis/audit-service — append-only §26.3 audit event service.
 *
 * Internal callers append camelCase audit events. The service persists snake_case
 * columns, computes a per-table hash chain inside the insert transaction, and
 * exposes only public target-scoped rows through the §23 audit read path.
 */
import { createHash } from 'node:crypto';
import { checkDatabase, getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { operationalRoutes, result, startService } from '@polis/service-runtime';
import type { Route } from '@polis/service-runtime';

/** Bounded database readiness without exposing database failure details. */
export async function databaseReadiness(
  check: () => Promise<unknown> = checkDatabase,
): Promise<{ ready: true } | { ready: false; dependency: 'database' }> {
  try {
    await check();
    return { ready: true };
  } catch {
    return { ready: false, dependency: 'database' };
  }
}

export type AuditEventInput = {
  eventType?: unknown;
  actor?: { type?: unknown; id?: unknown };
  target?: { type?: unknown; id?: unknown };
  action?: unknown;
  reason?: unknown;
  correlationId?: unknown;
  visibility?: unknown;
  data?: unknown;
  redactedData?: unknown;
};

export type CanonicalAuditEvent = {
  eventType: string;
  actorType: string;
  actorId: string;
  targetType: string | null;
  targetId: string | null;
  action: string;
  reason: string | null;
  correlationId: string | null;
  visibility: string;
  data: unknown;
  redactedData: unknown;
  createdAt: string;
};

type AuditEventRow = (typeof schema.auditEvents)['$inferSelect'];

type StableJson = null | boolean | number | string | StableJson[] | { [key: string]: StableJson };

function stableValue(value: unknown): StableJson {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object') {
    const out: { [key: string]: StableJson } = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return null;
}

export function canonicalAuditJson(event: CanonicalAuditEvent): string {
  return JSON.stringify(stableValue(event));
}

export function buildCanonicalAuditEvent(input: {
  eventType: string;
  actorType: string;
  actorId: string;
  targetType?: string | null;
  targetId?: string | null;
  action: string;
  reason?: string | null;
  correlationId?: string | null;
  visibility: string;
  data?: unknown;
  redactedData?: unknown;
  createdAt: string;
}): CanonicalAuditEvent {
  return {
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    action: input.action,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
    visibility: input.visibility,
    data: input.data ?? null,
    redactedData: input.redactedData ?? null,
    createdAt: input.createdAt,
  };
}

export function computeAuditHash(
  previousHash: string | null,
  canonicalEvent: CanonicalAuditEvent | string,
): string {
  const canonical =
    typeof canonicalEvent === 'string' ? canonicalEvent : canonicalAuditJson(canonicalEvent);
  return createHash('sha256')
    .update(`${previousHash ?? ''}${canonical}`)
    .digest('hex');
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function auditEventWire(row: AuditEventRow) {
  return {
    id: row.id,
    eventType: row.eventType,
    actorType: row.actorType,
    actorId: row.actorId,
    targetType: row.targetType,
    targetId: row.targetId,
    action: row.action,
    reason: row.reason,
    correlationId: row.correlationId,
    visibility: row.visibility,
    data: row.data,
    redactedData: row.redactedData,
    createdAt: row.createdAt.toISOString(),
    hash: row.hash,
    previousHash: row.previousHash,
  };
}

export function auditRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('audit-service'),
    {
      method: 'POST',
      path: '/internal/audit/events',
      handler: async (_req, body: unknown) => {
        const event = body as AuditEventInput | undefined;
        const eventType = stringField(event?.eventType);
        if (!eventType) return result(400, { error: 'missing_event_type' });
        const action = stringField(event?.action);
        if (!action) return result(400, { error: 'missing_action' });
        const visibility = stringField(event?.visibility);
        if (!visibility) return result(400, { error: 'missing_visibility' });
        const actorType = stringField(event?.actor?.type);
        const actorId = stringField(event?.actor?.id);
        if (!actorType || !actorId) return result(400, { error: 'missing_actor' });

        const targetType = stringField(event?.target?.type) ?? null;
        const targetId = stringField(event?.target?.id) ?? null;
        const createdAt = new Date().toISOString();
        const canonical = buildCanonicalAuditEvent({
          eventType,
          actorType,
          actorId,
          targetType,
          targetId,
          action,
          reason: stringField(event?.reason) ?? null,
          correlationId: stringField(event?.correlationId) ?? null,
          visibility,
          data: event?.data ?? null,
          redactedData: event?.redactedData ?? null,
          createdAt,
        });

        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`LOCK TABLE audit_events IN EXCLUSIVE MODE`);
          const previousRows = await tx
            .select({ hash: schema.auditEvents.hash })
            .from(schema.auditEvents)
            .orderBy(desc(schema.auditEvents.createdAt), desc(schema.auditEvents.id))
            .limit(1);
          const previousHash = previousRows[0]?.hash ?? null;
          const hash = computeAuditHash(previousHash, canonical);
          const inserted = await tx
            .insert(schema.auditEvents)
            .values({
              id: sql`gen_random_uuid()::text`,
              eventType,
              actorType,
              actorId,
              targetType,
              targetId,
              action,
              reason: canonical.reason,
              correlationId: canonical.correlationId,
              visibility,
              data: canonical.data,
              redactedData: canonical.redactedData,
              createdAt: new Date(createdAt),
              hash,
              previousHash,
            })
            .returning();
          return inserted[0];
        });

        return result(201, auditEventWire(row));
      },
    },
    {
      method: 'GET',
      path: '/api/v1/audit/:objectType/:objectId',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.visibility, 'public'),
              eq(schema.auditEvents.targetType, params.objectType),
              eq(schema.auditEvents.targetId, params.objectId),
            ),
          )
          .orderBy(schema.auditEvents.createdAt, schema.auditEvents.id);
        return { items: rows.map(auditEventWire) };
      },
    },
  ];
}

async function main(): Promise<void> {
  const db = getClient();
  startService(
    'audit-service',
    Number(process.env.PORT ?? process.env.AUDIT_SERVICE_PORT ?? 8600),
    auditRoutes(db),
    { readiness: databaseReadiness },
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

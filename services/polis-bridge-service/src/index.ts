/**
 * @polis/polis-bridge-service — §13 Polis deliberation bridge.
 *
 * Owns issues, conversations, and append-only conversation result snapshots.
 * Public reads are proxied through platform-api; the create/sync POST routes
 * are internal-only (service-level trust). The Polis upstream is a deterministic
 * stub in M2; see ./polis-client.ts.
 */

import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import { createPolisClient, type ParticipationMode, type PolisClient } from './polis-client.js';
import {
  conversationResultWire,
  conversationWire,
  issueWire,
  type ConversationRow,
} from './serialize.js';

/** Stable 404 contract for detail endpoints. */
const notFound = (id: string): HttpResult => result(404, { error: 'not_found', id });

const PARTICIPATION_MODES: readonly ParticipationMode[] = [
  'open',
  'pseudonymous',
  'verified',
  'partner_restricted',
];

function asParticipationMode(value: unknown): ParticipationMode {
  return typeof value === 'string' && (PARTICIPATION_MODES as readonly string[]).includes(value)
    ? (value as ParticipationMode)
    : 'open';
}

/**
 * Best-effort audit emit. Failures (audit-service unreachable) are logged and
 * never fail the originating request — matches platform-api's non-fatal handling.
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
        actor: { type: 'service', id: 'polis-bridge-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'polis-bridge-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Latest conversation for an issue (by created_at desc), or null. */
async function latestConversation(db: DbClient, issueId: string): Promise<ConversationRow | null> {
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.issueId, issueId))
    .orderBy(desc(schema.conversations.createdAt), desc(schema.conversations.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Build the §13 Polis route table bound to a DB client + Polis adapter. */
export function polisRoutes(db: DbClient, polis: PolisClient): Route[] {
  return [
    ...operationalRoutes('polis-bridge-service'),

    {
      method: 'GET',
      path: '/api/v1/issues',
      handler: async (req) => {
        const sp = new URL(req.url ?? '/', 'http://localhost').searchParams;
        const jurisdictionId = sp.get('jurisdiction_id');
        const processId = sp.get('process_id');
        const conds = [];
        if (jurisdictionId) conds.push(eq(schema.issues.jurisdictionId, jurisdictionId));
        if (processId) conds.push(eq(schema.issues.processId, processId));
        const rows = await db
          .select()
          .from(schema.issues)
          .orderBy(desc(schema.issues.createdAt))
          .where(conds.length ? and(...conds) : undefined);
        return { items: rows.map(issueWire) };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/issues/:id',
      handler: async (_req, _body, params) => {
        const rows = await db.select().from(schema.issues).where(eq(schema.issues.id, params.id));
        const issue = rows[0];
        if (!issue) return notFound(params.id);
        const conversation = await latestConversation(db, params.id);
        let conversationResult = null;
        if (conversation) {
          const resultRows = await db
            .select()
            .from(schema.conversationResults)
            .where(eq(schema.conversationResults.conversationId, conversation.id))
            .orderBy(
              desc(schema.conversationResults.capturedAt),
              desc(schema.conversationResults.id),
            )
            .limit(1);
          conversationResult = resultRows[0] ? conversationResultWire(resultRows[0]) : null;
        }
        return {
          ...issueWire(issue),
          conversation: conversation ? conversationWire(conversation) : null,
          conversationResult,
        };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/processes/:id/issues',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.issues)
          .where(eq(schema.issues.processId, params.id))
          .orderBy(desc(schema.issues.createdAt));
        return { items: rows.map(issueWire) };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/issues/:id/conversation',
      handler: async (_req, _body, params) => {
        const conversation = await latestConversation(db, params.id);
        const reportUrl = conversation?.reportUrl ?? null;
        return {
          issueId: params.id,
          conversation: conversation ? conversationWire(conversation) : null,
          embed: {
            mode: reportUrl ? 'iframe' : 'stub',
            src: reportUrl,
            framingQuestion: conversation?.framingQuestion ?? null,
          },
        };
      },
    },

    // Internal-only: not proxied through the public BFF. Service-level trust.
    {
      method: 'POST',
      path: '/internal/polis/conversations',
      handler: async (_req, body) => {
        const input = body as {
          issueId?: string;
          title?: string;
          framingQuestion?: string;
          participationMode?: unknown;
        };
        const issueId = input.issueId;
        if (!issueId) return result(400, { error: 'missing_issue_id' });
        const issueRows = await db
          .select()
          .from(schema.issues)
          .where(eq(schema.issues.id, issueId));
        if (!issueRows[0]) return notFound(issueId);

        const created = await polis.createConversation({
          issueId,
          title: input.title ?? '',
          framingQuestion: input.framingQuestion ?? '',
          participationMode: asParticipationMode(input.participationMode),
        });
        const inserted = await db
          .insert(schema.conversations)
          .values({
            id: sql`gen_random_uuid()::text`,
            issueId,
            externalPolisId: created.externalPolisId,
            title: input.title ?? '',
            framingQuestion: input.framingQuestion ?? '',
            participationMode: asParticipationMode(input.participationMode),
            status: 'draft',
            reportUrl: created.reportUrl,
          })
          .returning();
        const row = inserted[0];
        await emitAudit({
          eventType: 'polis.conversation.created',
          action: 'create',
          target: { type: 'conversation', id: row.id },
          data: { issueId, externalPolisId: created.externalPolisId },
        });
        return result(201, conversationWire(row));
      },
    },

    // Internal-only: append-only result sync. Never updates an existing row.
    {
      method: 'POST',
      path: '/internal/polis/conversations/:id/sync',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, params.id));
        const conversation = rows[0];
        if (!conversation) return notFound(params.id);
        const report = await polis.fetchReport(conversation.externalPolisId);
        const inserted = await db
          .insert(schema.conversationResults)
          .values({
            id: sql`gen_random_uuid()::text`,
            conversationId: conversation.id,
            consensusGroups: report.consensusGroups,
            participantCount: String(report.participantCount),
          })
          .returning();
        const newRow = inserted[0];
        await emitAudit({
          eventType: 'polis.result.synced',
          action: 'sync',
          target: { type: 'conversation', id: conversation.id },
          data: {
            conversationId: conversation.id,
            resultId: newRow.id,
            participantCount: report.participantCount,
          },
        });
        return result(201, conversationResultWire(newRow));
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.POLIS_BRIDGE_SERVICE_PORT ?? 8200);
  const db = getClient();
  const polis = createPolisClient();
  startService('polis-bridge-service', port, polisRoutes(db, polis));
  console.log(JSON.stringify({ service: 'polis-bridge-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

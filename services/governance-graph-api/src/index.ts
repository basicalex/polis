/**
 * @polis/governance-graph-api — internal governance read service over Postgres.
 *
 * Serves the §23.1 governance reads (and a typed graph/traverse API) backed by
 * the governance + evidence + graph tables. platform-api proxies these paths
 * as the public BFF edge. Wire objects are camelCase (see ./serialize.ts).
 */
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import type { IncomingMessage } from 'node:http';
import { and, asc, countDistinct, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';
import {
  claimWire,
  commitmentQuestionWire,
  commitmentStatusEventWire,
  commitmentWire,
  documentTypeWire,
  evidenceLinkWire,
  failureModeWire,
  institutionWire,
  jurisdictionWire,
  mandateHolderWire,
  processStepWire,
  processWire,
  relationshipWire,
  roleWire,
  sourceWire,
  type ClaimWire,
  type CommitmentQuestionWire,
  type CommitmentStatusEventWire,
  type EvidenceLinkWire,
  type InstitutionWire,
  type JurisdictionWire,
  type MandateHolderWire,
  type ProcessWire,
  type RelationshipWire,
  type RoleWire,
} from './serialize.js';

type EvidenceLinkRow = (typeof schema.evidenceLinks)['$inferSelect'] & { visibility: string };

/** Query params from an IncomingMessage URL. Used across every list handler. */
function query(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams;
}

/** Stable 404 contract for detail endpoints. */
const notFound = (id: string): HttpResult => result(404, { error: 'not_found', id });

/** Build the §23.1 + graph route table bound to a DB client. */
export function graphRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('governance-graph-api'),

    {
      method: 'GET',
      path: '/api/v1/jurisdictions',
      handler: async () => {
        const rows = await db.select().from(schema.jurisdictions);
        const items: JurisdictionWire[] = rows.map(jurisdictionWire);
        return { items };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/institutions',
      handler: async (req) => {
        const jurisdictionId = query(req).get('jurisdiction_id');
        const rows = await db
          .select()
          .from(schema.institutions)
          .where(
            jurisdictionId ? eq(schema.institutions.jurisdictionId, jurisdictionId) : undefined,
          );
        const items: InstitutionWire[] = rows.map(institutionWire);
        return { items };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/institutions/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.institutions)
          .where(eq(schema.institutions.id, params.id));
        const row = rows[0];
        if (!row) return notFound(params.id);
        const roles = await db
          .select()
          .from(schema.roles)
          .where(eq(schema.roles.institutionId, params.id));
        return { ...institutionWire(row), roles: roles.map((r) => roleWire(r, null)) };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/roles/:id',
      handler: async (_req, _body, params) => {
        const rows = await db.select().from(schema.roles).where(eq(schema.roles.id, params.id));
        const row = rows[0];
        if (!row) return notFound(params.id);
        const mandates = row.mandateId
          ? await db.select().from(schema.mandates).where(eq(schema.mandates.id, row.mandateId))
          : [];
        const wire: RoleWire = roleWire(row, mandates[0] ?? null);
        return wire;
      },
    },

    {
      method: 'GET',
      path: '/api/v1/processes',
      handler: async () => {
        const rows = await db.select().from(schema.processes);
        return {
          items: rows.map((r) => ({
            id: r.id,
            name: r.name,
            need: r.need,
            legalBasis: r.legalBasis,
            reviewState: r.reviewState,
          })),
        };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/processes/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.processes)
          .where(eq(schema.processes.id, params.id));
        const row = rows[0];
        if (!row) return notFound(params.id);
        const steps = await db
          .select()
          .from(schema.processSteps)
          .where(eq(schema.processSteps.processId, params.id));
        const failureModes = await db
          .select()
          .from(schema.failureModes)
          .where(eq(schema.failureModes.processId, params.id));

        // Required document types = STEP_REQUIRES_DOCUMENT_TYPE edges from this process's steps.
        const stepIds = steps.map((s) => s.id);
        const docTypeIds = new Set<string>();
        if (stepIds.length) {
          const edges = await db
            .select()
            .from(schema.relationships)
            .where(
              and(
                eq(schema.relationships.relationshipType, 'STEP_REQUIRES_DOCUMENT_TYPE'),
                inArray(schema.relationships.fromEntityId, stepIds),
              ),
            );
          for (const e of edges) docTypeIds.add(e.toEntityId);
        }
        const requiredDocuments =
          docTypeIds.size > 0
            ? await db
                .select()
                .from(schema.documentTypes)
                .where(inArray(schema.documentTypes.id, [...docTypeIds]))
            : [];

        const wire: ProcessWire = processWire(
          row,
          steps.map(processStepWire),
          requiredDocuments.map(documentTypeWire),
          failureModes.map(failureModeWire),
        );
        return wire;
      },
    },

    {
      method: 'GET',
      path: '/api/v1/document-types/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.documentTypes)
          .where(eq(schema.documentTypes.id, params.id));
        return rows[0] ? documentTypeWire(rows[0]) : notFound(params.id);
      },
    },

    {
      method: 'GET',
      path: '/api/v1/laws/:id',
      handler: async (_req, _body, params) => {
        const rows = await db.select().from(schema.laws).where(eq(schema.laws.id, params.id));
        return rows[0] ?? notFound(params.id);
      },
    },

    {
      method: 'GET',
      path: '/api/v1/budget-lines/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.budgetLines)
          .where(eq(schema.budgetLines.id, params.id));
        return rows[0] ?? notFound(params.id);
      },
    },

    {
      method: 'GET',
      path: '/api/v1/failure-modes',
      handler: async () => {
        const rows = await db.select().from(schema.failureModes);
        return { items: rows.map(failureModeWire) };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/controls',
      handler: async () => {
        const rows = await db.select().from(schema.controls);
        return {
          items: rows.map((r) => ({ id: r.id, name: r.name, description: r.description })),
        };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/proposals/:id',
      handler: (_req, _body, params) => notFound(params.id),
    },
    {
      method: 'GET',
      path: '/api/v1/assessments/:id',
      handler: (_req, _body, params) => notFound(params.id),
    },

    {
      method: 'GET',
      path: '/api/v1/claims',
      handler: async (req) => {
        const subjectId = query(req).get('subject_id');
        const claims = await db
          .select()
          .from(schema.claims)
          .where(subjectId ? eq(schema.claims.subjectId, subjectId) : undefined);
        const items: ClaimWire[] = await Promise.all(
          claims.map(async (c) => {
            const [evidenceRows, sourceIds] = await loadEvidence(db, c.id);
            const sources = sourceIds.length
              ? await db.select().from(schema.sources).where(inArray(schema.sources.id, sourceIds))
              : [];
            return claimWire(c, evidenceRows.map(evidenceLinkWire), sources.map(sourceWire));
          }),
        );
        return { items };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/claims/:id',
      handler: async (_req, _body, params) => {
        const rows = await db.select().from(schema.claims).where(eq(schema.claims.id, params.id));
        const c = rows[0];
        if (!c) return notFound(params.id);
        const [evidenceRows, sourceIds] = await loadEvidence(db, c.id);
        const sources = sourceIds.length
          ? await db.select().from(schema.sources).where(inArray(schema.sources.id, sourceIds))
          : [];
        const wire: ClaimWire = claimWire(
          c,
          evidenceRows.map(evidenceLinkWire),
          sources.map(sourceWire),
        );
        return wire;
      },
    },

    // Typed graph edges (§11.5)
    {
      method: 'GET',
      path: '/api/v1/relationships',
      handler: async (req) => {
        const sp = query(req);
        const conds = [];
        const type = sp.get('type');
        const fromId = sp.get('from_id');
        const toId = sp.get('to_id');
        if (type) conds.push(eq(schema.relationships.relationshipType, type));
        if (fromId) conds.push(eq(schema.relationships.fromEntityId, fromId));
        if (toId) conds.push(eq(schema.relationships.toEntityId, toId));
        const rows = await db
          .select()
          .from(schema.relationships)
          .where(conds.length ? and(...conds) : undefined);
        const items: RelationshipWire[] = rows.map(relationshipWire);
        return { items };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/graph/traverse',
      handler: async (req) => {
        const sp = query(req);
        const entityId = sp.get('entity_id');
        const entityType = sp.get('entity_type');
        if (!entityId || !entityType)
          return result(400, { error: 'entity_id and entity_type required' });
        const rows = await db
          .select()
          .from(schema.relationships)
          .where(
            and(
              eq(schema.relationships.fromEntityId, entityId),
              eq(schema.relationships.fromEntityType, entityType),
            ),
          );
        return {
          entityType,
          entityId,
          edges: rows.map((r) => ({
            relationshipType: r.relationshipType,
            toEntityType: r.toEntityType,
            toEntityId: r.toEntityId,
          })),
        };
      },
    },

    // M-RA (Phase 1) — read-only public mandate-holder layer.
    {
      method: 'GET',
      path: '/api/v1/mandate-holders',
      handler: async (req) => {
        const jur = query(req).get('jurisdiction_id');
        const rows = await db
          .select()
          .from(schema.mandateHolders)
          .where(
            and(
              eq(schema.mandateHolders.status, 'active'),
              jur ? eq(schema.mandateHolders.jurisdictionId, jur) : undefined,
            ),
          );
        const items: MandateHolderWire[] = rows.map(mandateHolderWire);
        return { items };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/mandate-holders/:id',
      handler: async (_req, _body, params) => {
        const holderRows = await db
          .select()
          .from(schema.mandateHolders)
          .where(eq(schema.mandateHolders.id, params.id));
        const row = holderRows[0];
        if (!row) return notFound(params.id);

        const charterRows = await db
          .select({
            status: schema.mandateHolderCharters.status,
            version: schema.mandateHolderCharters.version,
            signedAt: schema.mandateHolderCharters.signedAt,
            proofManifestId: schema.mandateHolderCharters.proofManifestId,
            signedArtifactId: schema.mandateHolderCharters.signedArtifactId,
          })
          .from(schema.mandateHolderCharters)
          .where(eq(schema.mandateHolderCharters.mandateHolderId, params.id))
          .orderBy(
            desc(schema.mandateHolderCharters.version),
            desc(schema.mandateHolderCharters.updatedAt),
          )
          .limit(1);
        const charter = charterRows[0] ?? null;
        const artifactRows = charter?.signedArtifactId
          ? await db
              .select({ sha256: schema.documentArtifacts.sha256 })
              .from(schema.documentArtifacts)
              .where(eq(schema.documentArtifacts.id, charter.signedArtifactId))
              .limit(1)
          : [];
        const signedArtifact = artifactRows[0] ?? null;

        const commitmentRows = await db
          .select()
          .from(schema.commitments)
          .where(eq(schema.commitments.mandateHolderId, params.id));
        const commitments = await Promise.all(
          commitmentRows.map(async (c) => {
            const effective = await effectiveStatus(db, c.id, c.dueAt);
            const claimRows = await db
              .select()
              .from(schema.claims)
              .where(eq(schema.claims.id, c.claimId));
            const claim = claimRows[0];
            if (!claim) {
              return { ...commitmentWire(c), effectiveStatus: effective, claim: null };
            }
            const [evidenceRows, sourceIds] = await loadEvidence(db, claim.id);
            const sources = sourceIds.length
              ? await db.select().from(schema.sources).where(inArray(schema.sources.id, sourceIds))
              : [];
            return {
              ...commitmentWire(c),
              effectiveStatus: effective,
              claim: claimWire(claim, evidenceRows.map(evidenceLinkWire), sources.map(sourceWire)),
            };
          }),
        );

        return {
          ...mandateHolderWire(row),
          charterAccepted: charter?.status === 'accepted',
          charterStatus: charter?.status ?? null,
          charterVersion: charter?.version ?? null,
          charterSignedAt: charter?.signedAt?.toISOString() ?? null,
          charterProofId: charter?.proofManifestId ?? null,
          charterSignedDocumentHash: signedArtifact?.sha256 ?? null,
          commitments,
          answeredQuestionCount: await answeredQuestionCount(db, params.id),
        };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/mandate-holders/:id/scorecard',
      handler: async (_req, _body, params) => {
        const holderRows = await db
          .select()
          .from(schema.mandateHolders)
          .where(eq(schema.mandateHolders.id, params.id));
        if (!holderRows[0]) return notFound(params.id);

        const commitmentRows = await db
          .select()
          .from(schema.commitments)
          .where(eq(schema.commitments.mandateHolderId, params.id));

        const totals = {
          delivered: 0,
          partial: 0,
          notDelivered: 0,
          inProgress: 0,
          proposed: 0,
          overdue: 0,
        };
        for (const c of commitmentRows) {
          const status = await effectiveStatus(db, c.id, c.dueAt);
          if (status === 'delivered') totals.delivered += 1;
          else if (status === 'partial') totals.partial += 1;
          else if (status === 'not_delivered') totals.notDelivered += 1;
          else if (status === 'in_progress') totals.inProgress += 1;
          else if (status === 'proposed') totals.proposed += 1;
          else if (status === 'overdue') totals.overdue += 1;
        }
        return { mandateHolderId: params.id, totals };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/commitments/:id',
      handler: async (_req, _body, params) => {
        const commitmentRows = await db
          .select()
          .from(schema.commitments)
          .where(eq(schema.commitments.id, params.id));
        const row = commitmentRows[0];
        if (!row) return notFound(params.id);

        const eventRows = await db
          .select()
          .from(schema.commitmentStatusEvents)
          .where(eq(schema.commitmentStatusEvents.commitmentId, params.id))
          .orderBy(desc(schema.commitmentStatusEvents.createdAt));
        const timeline: CommitmentStatusEventWire[] = eventRows.map(commitmentStatusEventWire);

        const latest = eventRows[0];
        let resolution: { claim: ClaimWire; evidence: EvidenceLinkWire[] } | null = null;
        if (latest?.resolutionClaimId) {
          const claimRows = await db
            .select()
            .from(schema.claims)
            .where(eq(schema.claims.id, latest.resolutionClaimId));
          const resolutionClaim = claimRows[0];
          if (resolutionClaim) {
            const [evidenceRows] = await loadEvidence(db, resolutionClaim.id);
            resolution = {
              claim: claimWire(resolutionClaim, evidenceRows.map(evidenceLinkWire), []),
              evidence: evidenceRows.map(evidenceLinkWire),
            };
          }
        }

        const commitmentClaimRows = await db
          .select()
          .from(schema.claims)
          .where(eq(schema.claims.id, row.claimId));
        const commitmentClaim = commitmentClaimRows[0];
        let claim: ClaimWire | null = null;
        if (commitmentClaim) {
          const [evidenceRows, sourceIds] = await loadEvidence(db, commitmentClaim.id);
          const sources = sourceIds.length
            ? await db.select().from(schema.sources).where(inArray(schema.sources.id, sourceIds))
            : [];
          claim = claimWire(commitmentClaim, evidenceRows.map(evidenceLinkWire), sources.map(sourceWire));
        }

        return {
          ...commitmentWire(row),
          effectiveStatus: await effectiveStatus(db, row.id, row.dueAt),
          statusTimeline: timeline,
          claim,
          resolution,
          questions: await loadCommitmentQuestions(db, row.id),
        };
      },
    },

    // M-RA Phase 3 — public read of a commitment's Q&A (questions + latest answer).
    {
      method: 'GET',
      path: '/api/v1/commitments/:id/questions',
      handler: async (_req, _body, params) => {
        const commitmentRows = await db
          .select({ id: schema.commitments.id })
          .from(schema.commitments)
          .where(eq(schema.commitments.id, params.id))
          .limit(1);
        if (!commitmentRows[0]) return notFound(params.id);
        return { items: await loadCommitmentQuestions(db, params.id) };
      },
    },
  ];
}

/** Evidence links for a claim + the distinct source ids they reference. */
async function loadEvidence(db: DbClient, claimId: string): Promise<[EvidenceLinkRow[], string[]]> {
  const evidenceRows = await db
    .select({
      id: schema.evidenceLinks.id,
      claimId: schema.evidenceLinks.claimId,
      sourceId: schema.evidenceLinks.sourceId,
      locator: schema.evidenceLinks.locator,
      quote: schema.evidenceLinks.quote,
      paraphrase: schema.evidenceLinks.paraphrase,
      sourceHash: schema.evidenceLinks.sourceHash,
      retrievedAt: schema.evidenceLinks.retrievedAt,
      confidence: schema.evidenceLinks.confidence,
      visibility: schema.evidenceLinks.visibility,
    })
    .from(schema.evidenceLinks)
    .where(eq(schema.evidenceLinks.claimId, claimId));
  const sourceIdSet = new Set<string>();
  for (const e of evidenceRows) sourceIdSet.add(e.sourceId);
  return [evidenceRows, [...sourceIdSet]];
}

/**
 * M-RA effective commitment status: latest-row-wins over
 * commitment_status_events, with `overdue` derived when due_at is past and the
 * latest event is non-terminal (proposed|in_progress). Terminal events
 * (delivered|partial|not_delivered) are never overridden by overdue.
 */
async function effectiveStatus(
  db: DbClient,
  commitmentId: string,
  dueAt: Date | null,
): Promise<string> {
  const ev = await db
    .select()
    .from(schema.commitmentStatusEvents)
    .where(eq(schema.commitmentStatusEvents.commitmentId, commitmentId))
    .orderBy(desc(schema.commitmentStatusEvents.createdAt))
    .limit(1);
  const latest = ev[0]?.status ?? 'proposed';
  if (dueAt && dueAt < new Date() && (latest === 'proposed' || latest === 'in_progress')) {
    return 'overdue';
  }
  return latest;
}

/**
 * M-RA commitment questions with their latest applied answer (if any).
 * Latest answer wins (commitment_answers append-only, created_at DESC LIMIT 1).
 * Mirrors the lazy per-row load used for the commitments list.
 */
async function loadCommitmentQuestions(
  db: DbClient,
  commitmentId: string,
): Promise<CommitmentQuestionWire[]> {
  const qRows = await db
    .select()
    .from(schema.commitmentQuestions)
    .where(eq(schema.commitmentQuestions.commitmentId, commitmentId))
    .orderBy(asc(schema.commitmentQuestions.createdAt));
  return Promise.all(
    qRows.map(async (q) => {
      const aRows = await db
        .select()
        .from(schema.commitmentAnswers)
        .where(eq(schema.commitmentAnswers.questionId, q.id))
        .orderBy(desc(schema.commitmentAnswers.createdAt))
        .limit(1);
      return commitmentQuestionWire(q, aRows[0] ?? null);
    }),
  );
}

/**
 * M-RA answered-question count for a mandate-holder projection. Counts
 * questions across the holder's commitments that have ≥1 answer (pure count,
 * no grade/ranking — anti-endorsement). One aggregate query via a join.
 */
async function answeredQuestionCount(db: DbClient, mandateHolderId: string): Promise<number> {
  const rows = await db
    .select({ n: countDistinct(schema.commitmentQuestions.id) })
    .from(schema.commitmentQuestions)
    .innerJoin(
      schema.commitments,
      eq(schema.commitments.id, schema.commitmentQuestions.commitmentId),
    )
    .innerJoin(
      schema.commitmentAnswers,
      eq(schema.commitmentAnswers.questionId, schema.commitmentQuestions.id),
    )
    .where(eq(schema.commitments.mandateHolderId, mandateHolderId));
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.GOVERNANCE_GRAPH_API_PORT ?? 8100);
  const db = getClient();
  startService('governance-graph-api', port, graphRoutes(db));
  console.log(JSON.stringify({ service: 'governance-graph-api', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

/**
 * @polis/proof-service — §9.12 + §9.18 public trust boundary.
 *
 * Owns the proof_manifests registry. Persists canonicalized hashes into an
 * immutable manifest, serves the public proof read + verify contract, and
 * reads its own audit trail directly from the audit_events table (the audit
 * read is filtered by targetType+targetId, so {type:'proof', id:<manifestId>}
 * is already queryable via the generic BFF audit route).
 *
 * `verify/file` reuses @polis/domain sha256Hex to compute the original-file
 * hash directly — a verify must never depend on the ingestion pipeline being up.
 */
import { randomUUID } from 'node:crypto';
import { checkDatabase, getClient } from '@polis/db';
import type { DbClient } from '@polis/db';
import { sha256Hex, type ProofSignature, type ProofTimestamp } from '@polis/domain';
import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  MAX_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import { schema } from '@polis/db';
import {
  documentProofWire,
  mapSignature,
  mapTimestamp,
  type SupersessionView,
  type RevocationView,
} from './serialize.js';

/** Stable 404 contract for detail endpoints. */
const notFound = (id: string): HttpResult => result(404, { error: 'not_found', id });

const MANIFEST_CREATOR_SERVICES: Record<string, true> = {
  'document-ingestion-gateway': true,
  'document-signing-service': true,
};

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

/** Validate the deadline applied to every internal outbound request. */
export function internalFetchTimeoutMs(
  value: string | undefined = process.env.INTERNAL_FETCH_TIMEOUT_MS,
): number {
  if (value === undefined) return DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FETCH_TIMEOUT_MS) {
    throw new RangeError(
      `INTERNAL_FETCH_TIMEOUT_MS must be an integer between 1 and ${MAX_FETCH_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

/**
 * Best-effort audit emit. Failures (audit-service unreachable) are logged and
 * never fail the originating request — matches platform-api + polis-bridge.
 */
async function emitAudit(event: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
  correlationId?: string;
  visibility: 'public' | 'restricted';
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetchWithTimeout(
      base + '/internal/audit/events',
      {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({
          eventType: event.eventType,
          action: event.action,
          visibility: event.visibility,
          actor: { type: 'service', id: 'proof-service' },
          target: event.target,
          data: event.data,
          correlationId: event.correlationId ?? null,
        }),
      },
      internalFetchTimeoutMs(),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'proof-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Latest public manifest for an original-file hash, or null. */
async function findLatestPublicByHash(
  db: DbClient,
  hash: string,
): Promise<typeof schema.proofManifests.$inferSelect | null> {
  const rows = await db
    .select()
    .from(schema.proofManifests)
    .where(
      and(
        eq(schema.proofManifests.originalFileHash, hash),
        eq(schema.proofManifests.proofVisibility, 'public'),
      ),
    )
    .orderBy(desc(schema.proofManifests.createdAt), desc(schema.proofManifests.id))
    .limit(1);
  return rows[0]?.proofVisibility === 'public' ? rows[0] : null;
}

/** POST JSON to an internal service; throw on non-2xx so the caller can decide. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(body),
    },
    internalFetchTimeoutMs(),
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ status: res.status }));
    throw new Error(JSON.stringify(detail));
  }
  return (await res.json()) as T;
}

/** Read the latest supersession row for a proof (or null). */
async function latestSupersession(db: DbClient, proofId: string): Promise<SupersessionView> {
  const rows = await db
    .select({
      supersedingProofId: schema.proofSupersessions.supersedingProofId,
      createdAt: schema.proofSupersessions.createdAt,
    })
    .from(schema.proofSupersessions)
    .where(eq(schema.proofSupersessions.supersededProofId, proofId))
    .orderBy(desc(schema.proofSupersessions.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  return {
    supersededBy: rows[0].supersedingProofId,
    supersededAt: rows[0].createdAt.toISOString(),
  };
}

/** Read the latest revocation row for a proof (or null). */
async function latestRevocation(db: DbClient, proofId: string): Promise<RevocationView> {
  const rows = await db
    .select({
      reason: schema.proofRevocations.reason,
      createdAt: schema.proofRevocations.createdAt,
    })
    .from(schema.proofRevocations)
    .where(eq(schema.proofRevocations.proofId, proofId))
    .orderBy(desc(schema.proofRevocations.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  return {
    revokedAt: rows[0].createdAt.toISOString(),
    reason: rows[0].reason,
  };
}

const auditVisibility = (proofVisibility: string): 'public' | 'restricted' =>
  proofVisibility === 'public' ? 'public' : 'restricted';

async function proofAuditVisibility(
  db: DbClient,
  proofId: string,
): Promise<'public' | 'restricted'> {
  const rows = await db
    .select({ proofVisibility: schema.proofManifests.proofVisibility })
    .from(schema.proofManifests)
    .where(eq(schema.proofManifests.id, proofId))
    .limit(1);
  return auditVisibility(rows[0]?.proofVisibility ?? 'restricted');
}

/** Read all signatures + timestamps for a proof as wire objects. */
async function fetchProofState(
  db: DbClient,
  proofId: string,
): Promise<{ signatures: ProofSignature[]; timestamps: ProofTimestamp[] }> {
  const [sigRows, tsRows] = await Promise.all([
    db
      .select()
      .from(schema.proofSignatures)
      .where(eq(schema.proofSignatures.proofId, proofId))
      .orderBy(schema.proofSignatures.createdAt),
    db
      .select()
      .from(schema.proofTimestamps)
      .where(eq(schema.proofTimestamps.proofId, proofId))
      .orderBy(schema.proofTimestamps.createdAt),
  ]);
  return {
    signatures: sigRows.map(mapSignature),
    timestamps: tsRows.map(mapTimestamp),
  };
}

/** Build the §9.12 proof + verify route table bound to a DB client. */
export function proofRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('proof-service'),

    // Internal-only: not proxied through the public BFF. Ingestion gateway calls it.
    {
      method: 'POST',
      path: '/internal/proofs/manifests',
      handler: async (_req, body) => {
        const input = body as {
          originalFileHash?: string;
          canonicalPdfHash?: string | null;
          ocrTextHash?: string | null;
          metadataHash?: string | null;
          manifestHash?: string;
          documentClass?: string;
          documentTypeId?: string | null;
          issuerId?: string;
          issuerName?: string;
          originalFilename?: string | null;
          originalMime?: string | null;
          originalBytes?: number | null;
          contentVisibility?: string;
          proofVisibility?: string;
          algorithm?: string;
          createdByService?: string;
        };
        if (
          input.createdByService !== undefined &&
          !Object.hasOwn(MANIFEST_CREATOR_SERVICES, input.createdByService)
        ) {
          return result(400, { error: 'invalid_created_by_service' });
        }
        if (
          !input.originalFileHash ||
          !input.manifestHash ||
          !input.documentClass ||
          !input.issuerId
        ) {
          return result(400, { error: 'missing_required_fields' });
        }
        const id = randomUUID();
        const createdAt = new Date();
        const values = {
          id,
          documentClass: input.documentClass,
          documentTypeId: input.documentTypeId ?? null,
          issuerId: input.issuerId,
          issuerName: input.issuerName ?? '',
          originalFileHash: input.originalFileHash,
          canonicalPdfHash: input.canonicalPdfHash ?? null,
          ocrTextHash: input.ocrTextHash ?? null,
          metadataHash: input.metadataHash ?? null,
          manifestHash: input.manifestHash,
          originalFilename: input.originalFilename ?? null,
          originalMime: input.originalMime ?? null,
          originalBytes: input.originalBytes == null ? null : String(input.originalBytes),
          algorithm: input.algorithm ?? 'sha256',
          registryStatus: 'unknown',
          contentVisibility: input.contentVisibility ?? 'public',
          proofVisibility: input.proofVisibility ?? 'public',
          createdAt,
          createdByService: input.createdByService ?? 'document-ingestion-gateway',
          auditCorrelationId: null,
          manifestJson: null,
        };
        const base = documentProofWire(values, [], [], null, null);
        const inserted = await db
          .insert(schema.proofManifests)
          .values({ ...values, manifestJson: base })
          .returning();
        const row = inserted[0];
        await emitAudit({
          eventType: 'proof.manifest.created',
          action: 'create',
          target: { type: 'proof', id: row.id },
          data: { originalFileHash: row.originalFileHash, manifestHash: row.manifestHash },
          visibility: auditVisibility(row.proofVisibility),
        });
        // A manifest remains non-active until both required evidence providers succeed.
        const signatureUrl = process.env.SIGNATURE_INTERNAL_URL ?? 'http://localhost:8900';
        const timestampUrl = process.env.TIMESTAMP_INTERNAL_URL ?? 'http://localhost:8800';
        let signature: ProofSignature | null = null;
        let timestamp: ProofTimestamp | null = null;
        try {
          signature = await postJson<ProofSignature>(signatureUrl + '/internal/signatures', {
            proofId: row.id,
            hash: row.manifestHash,
            issuerId: row.issuerId,
            issuerName: row.issuerName,
          });
        } catch (err) {
          console.warn(
            JSON.stringify({
              service: 'proof-service',
              stage: 'signature-create',
              warning: err instanceof Error ? err.message : 'unknown',
            }),
          );
          await emitAudit({
            eventType: 'proof.signature.missed',
            action: 'sign',
            target: { type: 'proof', id: row.id },
            data: { reason: 'signature_unavailable' },
            visibility: auditVisibility(row.proofVisibility),
          });
        }
        try {
          timestamp = await postJson<ProofTimestamp>(timestampUrl + '/internal/timestamps', {
            proofId: row.id,
            hash: row.manifestHash,
            algorithm: row.algorithm,
          });
        } catch (err) {
          console.warn(
            JSON.stringify({
              service: 'proof-service',
              stage: 'timestamp-create',
              warning: err instanceof Error ? err.message : 'unknown',
            }),
          );
          await emitAudit({
            eventType: 'proof.timestamp.missed',
            action: 'timestamp',
            target: { type: 'proof', id: row.id },
            data: { reason: 'timestamp_unavailable' },
            visibility: auditVisibility(row.proofVisibility),
          });
        }

        const signatures = signature ? [signature] : [];
        const timestamps = timestamp ? [timestamp] : [];
        if (signature && timestamp) {
          const activeRow = { ...row, registryStatus: 'active' };
          const activeManifest = documentProofWire(activeRow, signatures, timestamps, null, null);
          const activatedRows = await db
            .update(schema.proofManifests)
            .set({ registryStatus: 'active', manifestJson: activeManifest })
            .where(eq(schema.proofManifests.id, row.id))
            .returning();
          const activatedRow = activatedRows[0];
          await emitAudit({
            eventType: 'proof.manifest.activated',
            action: 'activate',
            target: { type: 'proof', id: row.id },
            data: { signatureId: signature.id, timestampId: timestamp.id },
            visibility: auditVisibility(row.proofVisibility),
          });
          return result(201, documentProofWire(activatedRow, signatures, timestamps, null, null));
        }

        return result(201, documentProofWire(row, signatures, timestamps, null, null));
      },
    },

    {
      method: 'POST',
      path: '/api/v1/verify/file',
      handler: async (_req, body) => {
        const input = body as { contentBase64?: string };
        if (!input.contentBase64) return result(400, { error: 'missing_content' });
        const bytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
        const hash = await sha256Hex(bytes);
        const row = await findLatestPublicByHash(db, hash);
        if (!row) return { status: 'not_found' as const, manifest: null };
        const [state, supersession, revocation] = await Promise.all([
          fetchProofState(db, row.id),
          latestSupersession(db, row.id),
          latestRevocation(db, row.id),
        ]);
        const manifest = documentProofWire(
          row,
          state.signatures,
          state.timestamps,
          supersession,
          revocation,
        );
        await emitAudit({
          eventType: 'proof.verified',
          action: 'verify',
          target: { type: 'proof', id: manifest.id },
          data: { method: 'file', result: manifest.registryStatus, originalFileHash: hash },
          visibility: 'public',
        });
        return {
          status: manifest.registryStatus === 'active' ? 'valid' : manifest.registryStatus,
          manifest,
        };
      },
    },

    {
      method: 'POST',
      path: '/api/v1/verify/hash',
      handler: async (_req, body) => {
        const input = body as { hash?: string };
        if (!input.hash) return result(400, { error: 'missing_hash' });
        const row = await findLatestPublicByHash(db, input.hash);
        if (!row) return { status: 'not_found' as const, manifest: null };
        const [state, supersession, revocation] = await Promise.all([
          fetchProofState(db, row.id),
          latestSupersession(db, row.id),
          latestRevocation(db, row.id),
        ]);
        const manifest = documentProofWire(
          row,
          state.signatures,
          state.timestamps,
          supersession,
          revocation,
        );
        const status = manifest.registryStatus === 'active' ? 'valid' : manifest.registryStatus;
        await emitAudit({
          eventType: 'proof.verified',
          action: 'verify',
          target: { type: 'proof', id: manifest.id },
          data: { method: 'hash', result: status, originalFileHash: input.hash },
          visibility: 'public',
        });
        return { status, manifest };
      },
    },

    {
      method: 'POST',
      path: '/api/v1/verify/manifest',
      handler: async (_req, body) => {
        const input = body as { manifestHash?: string };
        if (!input.manifestHash) return result(400, { error: 'missing_manifest_hash' });
        const rows = await db
          .select()
          .from(schema.proofManifests)
          .where(
            and(
              eq(schema.proofManifests.manifestHash, input.manifestHash),
              eq(schema.proofManifests.proofVisibility, 'public'),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row || row.proofVisibility !== 'public') {
          return { status: 'not_found' as const };
        }
        const [supersession, revocation] = await Promise.all([
          latestSupersession(db, row.id),
          latestRevocation(db, row.id),
        ]);
        const registryStatus = revocation
          ? 'revoked'
          : supersession
            ? 'superseded'
            : row.registryStatus;
        return { status: registryStatus === 'active' ? 'valid' : registryStatus };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/proofs/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.proofManifests)
          .where(eq(schema.proofManifests.id, params.id))
          .limit(1);
        if (!rows[0] || rows[0].proofVisibility !== 'public') return notFound(params.id);
        const row = rows[0];
        const [state, supersession, revocation] = await Promise.all([
          fetchProofState(db, row.id),
          latestSupersession(db, row.id),
          latestRevocation(db, row.id),
        ]);
        return documentProofWire(row, state.signatures, state.timestamps, supersession, revocation);
      },
    },

    {
      method: 'GET',
      path: '/api/v1/proofs/:id/status',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select({
            registryStatus: schema.proofManifests.registryStatus,
            proofVisibility: schema.proofManifests.proofVisibility,
            contentVisibility: schema.proofManifests.contentVisibility,
          })
          .from(schema.proofManifests)
          .where(eq(schema.proofManifests.id, params.id))
          .limit(1);
        if (!rows[0] || rows[0].proofVisibility !== 'public') return notFound(params.id);
        const stored = rows[0];
        const [supersession, revocation] = await Promise.all([
          latestSupersession(db, params.id),
          latestRevocation(db, params.id),
        ]);
        return {
          registryStatus: revocation
            ? 'revoked'
            : supersession
              ? 'superseded'
              : stored.registryStatus,
          contentVisibility: stored.contentVisibility,
          proofVisibility: stored.proofVisibility,
          supersededBy: supersession?.supersededBy ?? null,
        };
      },
    },

    {
      method: 'GET',
      path: '/api/v1/proofs/:id/audit',
      handler: async (_req, _body, params) => {
        const proofRows = await db
          .select({ proofVisibility: schema.proofManifests.proofVisibility })
          .from(schema.proofManifests)
          .where(eq(schema.proofManifests.id, params.id))
          .limit(1);
        if (!proofRows[0] || proofRows[0].proofVisibility !== 'public') {
          return notFound(params.id);
        }
        const rows = await db
          .select({
            eventType: schema.auditEvents.eventType,
            action: schema.auditEvents.action,
            data: schema.auditEvents.data,
            createdAt: schema.auditEvents.createdAt,
          })
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.targetType, 'proof'),
              eq(schema.auditEvents.targetId, params.id),
            ),
          )
          .orderBy(schema.auditEvents.createdAt);
        return { items: rows };
      },
    },

    // §15.7 issuer registry. Falls back to the M3 stub shape if the row is
    // not yet self-seeded (signature-service upserts it on first sign).
    {
      method: 'GET',
      path: '/api/v1/issuers/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.proofIssuers)
          .where(eq(schema.proofIssuers.id, params.id))
          .limit(1);
        const r = rows[0];
        if (!r) {
          return {
            id: params.id,
            name: 'Polis Interface Demo Authority',
            publicKeyRef: 'test-key-demo-v1',
          };
        }
        return {
          id: r.id,
          name: r.name,
          publicKeyRef: r.publicKeyRef,
          certificateRef: r.certificateRef,
          standard: r.standard,
        };
      },
    },

    // §15.2 provenance.supersedes — internal-only (§23.7 reserves the public
    // gov supersede for a later milestone). Append-only; latest row wins.
    {
      method: 'POST',
      path: '/internal/proofs/:id/supersede',
      handler: async (_req, body, params) => {
        const input = body as { supersedingProofId?: string; reason?: string };
        if (!input.supersedingProofId) {
          return result(400, { error: 'missing_superseding_proof_id' });
        }
        // Verify the superseding proof exists (the superseded proof is
        // already addressed by the route param; its existence was checked on
        // the original manifest insert).
        const targetRows = await db
          .select({ id: schema.proofManifests.id })
          .from(schema.proofManifests)
          .where(eq(schema.proofManifests.id, input.supersedingProofId))
          .limit(1);
        if (!targetRows[0]) {
          return result(404, {
            error: 'superseding_proof_not_found',
            id: input.supersedingProofId,
          });
        }
        await db.insert(schema.proofSupersessions).values({
          id: sql`gen_random_uuid()::text`,
          supersededProofId: params.id,
          supersedingProofId: input.supersedingProofId,
          reason: input.reason ?? null,
        });
        await emitAudit({
          eventType: 'proof.superseded',
          action: 'supersede',
          target: { type: 'proof', id: params.id },
          data: { supersededBy: input.supersedingProofId, reason: input.reason ?? null },
          visibility: await proofAuditVisibility(db, params.id),
        });
        return result(201, {
          supersededProofId: params.id,
          supersedingProofId: input.supersedingProofId,
          reason: input.reason ?? null,
        });
      },
    },

    // §15.2 registryStatus='revoked' — internal-only. Append-only; row
    // existence == revoked. Minimal M4 machinery (no CRL/OCSP).
    {
      method: 'POST',
      path: '/internal/proofs/:id/revoke',
      handler: async (_req, body, params) => {
        const input = body as { reason?: string; revokedBy?: string };
        await db.insert(schema.proofRevocations).values({
          id: sql`gen_random_uuid()::text`,
          proofId: params.id,
          reason: input.reason ?? null,
          revokedBy: input.revokedBy ?? null,
        });
        await emitAudit({
          eventType: 'proof.revoked',
          action: 'revoke',
          target: { type: 'proof', id: params.id },
          data: { reason: input.reason ?? null, revokedBy: input.revokedBy ?? null },
          visibility: await proofAuditVisibility(db, params.id),
        });
        return result(201, {
          proofId: params.id,
          reason: input.reason ?? null,
          revokedBy: input.revokedBy ?? null,
        });
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.PROOF_SERVICE_PORT ?? 8700);
  const db = getClient();
  startService('proof-service', port, proofRoutes(db), {
    readiness: databaseReadiness,
    validateConfig: () => {
      internalFetchTimeoutMs();
    },
  });
  console.log(JSON.stringify({ service: 'proof-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

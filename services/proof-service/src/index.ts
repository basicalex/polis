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
import { getClient } from '@polis/db';
import type { DbClient } from '@polis/db';
import { sha256Hex, type DocumentProof } from '@polis/domain';
import { and, desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import { schema } from '@polis/db';
import { documentProofWire } from './serialize.js';

/** Stable 404 contract for detail endpoints. */
const notFound = (id: string): HttpResult => result(404, { error: 'not_found', id });

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
        actor: { type: 'service', id: 'proof-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    });
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

/** Latest active manifest for an original-file hash, or null. */
async function findActiveByHash(db: DbClient, hash: string): Promise<DocumentProof | null> {
  const rows = await db
    .select()
    .from(schema.proofManifests)
    .where(
      and(
        eq(schema.proofManifests.originalFileHash, hash),
        eq(schema.proofManifests.registryStatus, 'active'),
      ),
    )
    .orderBy(desc(schema.proofManifests.createdAt), desc(schema.proofManifests.id))
    .limit(1);
  return rows[0] ? documentProofWire(rows[0]) : null;
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
        };
        if (
          !input.originalFileHash ||
          !input.manifestHash ||
          !input.documentClass ||
          !input.issuerId
        ) {
          return result(400, { error: 'missing_required_fields' });
        }
        const inserted = await db
          .insert(schema.proofManifests)
          .values({
            id: sql`gen_random_uuid()::text`,
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
            registryStatus: 'active',
            contentVisibility: input.contentVisibility ?? 'public',
            proofVisibility: input.proofVisibility ?? 'public',
            createdByService: 'document-ingestion-gateway',
          })
          .returning();
        const row = inserted[0];
        const wire = documentProofWire(row);
        await db
          .update(schema.proofManifests)
          .set({ manifestJson: wire })
          .where(eq(schema.proofManifests.id, row.id));
        await emitAudit({
          eventType: 'proof.manifest.created',
          action: 'create',
          target: { type: 'proof', id: row.id },
          data: { originalFileHash: row.originalFileHash, manifestHash: row.manifestHash },
        });
        return result(201, wire);
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
        const manifest = await findActiveByHash(db, hash);
        if (!manifest) return { status: 'not_found' as const, manifest: null };
        await emitAudit({
          eventType: 'proof.verified',
          action: 'verify',
          target: { type: 'proof', id: manifest.id },
          data: { method: 'file', result: 'valid', originalFileHash: hash },
        });
        return { status: 'valid' as const, manifest };
      },
    },

    {
      method: 'POST',
      path: '/api/v1/verify/hash',
      handler: async (_req, body) => {
        const input = body as { hash?: string };
        if (!input.hash) return result(400, { error: 'missing_hash' });
        const manifest = await findActiveByHash(db, input.hash);
        if (!manifest) return { status: 'not_found' as const, manifest: null };
        await emitAudit({
          eventType: 'proof.verified',
          action: 'verify',
          target: { type: 'proof', id: manifest.id },
          data: { method: 'hash', result: 'valid', originalFileHash: input.hash },
        });
        return { status: 'valid' as const, manifest };
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
          .where(eq(schema.proofManifests.manifestHash, input.manifestHash))
          .limit(1);
        const row = rows[0];
        if (!row || row.registryStatus !== 'active') return { status: 'not_found' as const };
        return { status: 'valid' as const };
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
        if (!rows[0]) return notFound(params.id);
        return documentProofWire(rows[0]);
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
        if (!rows[0]) return notFound(params.id);
        return rows[0];
      },
    },

    {
      method: 'GET',
      path: '/api/v1/proofs/:id/audit',
      handler: async (_req, _body, params) => {
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

    // §15.7 issuer registry stub. Real issuer keys land in M4.
    {
      method: 'GET',
      path: '/api/v1/issuers/:id',
      handler: async (_req, _body, params) => ({
        id: params.id,
        name: 'Polis Interface Demo Authority',
        publicKeyRef: 'test-key-demo-v1',
      }),
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.PROOF_SERVICE_PORT ?? 8700);
  const db = getClient();
  startService('proof-service', port, proofRoutes(db));
  console.log(JSON.stringify({ service: 'proof-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

/**
 * @polis/signature-service — §9.13 signature/e-seal issuer.
 *
 * Owns the proof_signatures + proof_issuers tables. Signs manifest hashes
 * with a test-key Ed25519 keypair (§15.7) and exposes the internal
 * signature-create + read contract used by proof-service orchestration.
 * Not proxied through the public BFF — internal-only, like paperless-adapter.
 *
 * Routes are bound to a {@link SignerClient} so the stub and the future HTTP
 * adapter share one contract. Audit events are emitted best-effort to the
 * audit-service internal endpoint.
 */
import { getClient } from '@polis/db';
import type { DbClient } from '@polis/db';
import { eq, sql } from 'drizzle-orm';
import {
  operationalRoutes,
  result,
  startService,
  type HttpResult,
  type Route,
} from '@polis/service-runtime';

import { schema } from '@polis/db';
import { createSignerClient, type SignerClient } from './signer-client.js';
import { proofSignatureWire } from './serialize.js';

/** Stable 404 contract for detail endpoints. */
const notFound = (id: string): HttpResult => result(404, { error: 'not_found', id });

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
        actor: { type: 'service', id: 'signature-service' },
        target: event.target,
        data: event.data,
        correlationId: event.correlationId ?? null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'signature-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Build the §9.13 route table bound to a DB client + signer. */
export function signatureRoutes(db: DbClient, client: SignerClient): Route[] {
  return [
    ...operationalRoutes('signature-service'),

    // §9.13 — sign a manifest hash and persist the signature.
    {
      method: 'POST',
      path: '/internal/signatures',
      handler: async (_req, body) => {
        const input = body as {
          proofId?: string;
          hash?: string;
          issuerId?: string;
          issuerName?: string;
        };
        if (!input.proofId || !input.hash || !input.issuerId) {
          return result(400, { error: 'missing_required_fields' });
        }
        // §15.7 issuer registry — self-seeding upsert so the demo issuer is
        // always present without a separate seed step.
        await db
          .insert(schema.proofIssuers)
          .values({
            id: input.issuerId,
            name: input.issuerName ?? input.issuerId,
            publicKeyRef: 'test-signer-stub-ed25519',
            certificateRef: null,
            standard: 'test-key',
          })
          .onConflictDoUpdate({
            target: schema.proofIssuers.id,
            set: { name: sql`EXCLUDED.name` },
          });
        const signed = await client.sign({
          proofId: input.proofId,
          hash: input.hash,
          issuerId: input.issuerId,
          issuerName: input.issuerName,
        });
        const inserted = await db
          .insert(schema.proofSignatures)
          .values({
            id: sql`gen_random_uuid()::text`,
            proofId: input.proofId,
            signedAt: new Date(signed.signedAt),
            issuerId: input.issuerId,
            type: signed.type,
            standard: signed.standard,
            signerRef: signed.signerRef,
            certificateRef: signed.certificateRef,
            signatureValueRef: signed.signatureValueRef,
            signedHash: signed.signedHash,
            validationStatus: signed.validationStatus,
          })
          .returning();
        const row = inserted[0];
        await emitAudit({
          eventType: 'proof.signature.created',
          action: 'create',
          target: { type: 'proof', id: input.proofId },
          data: { signatureId: row.id, issuerId: input.issuerId, standard: signed.standard },
        });
        return result(201, proofSignatureWire(row));
      },
    },

    // §9.13 — list signatures for a proof (oldest → newest).
    {
      method: 'GET',
      path: '/internal/signatures/:proofId',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.proofSignatures)
          .where(eq(schema.proofSignatures.proofId, params.proofId))
          .orderBy(schema.proofSignatures.createdAt);
        return { items: rows.map(proofSignatureWire) };
      },
    },

    // §15.7 issuer registry read.
    {
      method: 'GET',
      path: '/internal/issuers/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.proofIssuers)
          .where(eq(schema.proofIssuers.id, params.id))
          .limit(1);
        if (!rows[0]) return notFound(params.id);
        const r = rows[0];
        return {
          id: r.id,
          name: r.name,
          publicKeyRef: r.publicKeyRef,
          certificateRef: r.certificateRef,
          standard: r.standard,
        };
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? process.env.SIGNATURE_SERVICE_PORT ?? 8900);
  const client = createSignerClient();
  const db = getClient();
  startService('signature-service', port, signatureRoutes(db, client));
  console.log(JSON.stringify({ service: 'signature-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

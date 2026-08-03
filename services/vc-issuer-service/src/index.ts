/**
 * @polis/vc-issuer-service — §15 proof-only sharing via verifiable credentials (M8).
 *
 * Issues test-key-signed VCs for proof_only/vc_presentation grants. The VC
 * contains ONLY proof manifest refs + a verdict — never document content,
 * bytes, URLs, or OCR text. Crypto is test-key (HMAC, standard='test-key'
 * signal matching M4). Real issuer keys + DID resolution are post-pilot.
 *
 * The vault-service calls this service after a vc_presentation grant is
 * created; it passes {grantId, proofManifestId, manifestHash, issuerName,
 * scope} so the vc-issuer doesn't need to call back to the vault-service
 * (avoids circular dependency).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { eq } from 'drizzle-orm';
import {
  internalHeaders,
  operationalRoutes,
  result,
  startService,
  type Route,
} from '@polis/service-runtime';

/** HMAC key for VC signing. Dev default; operators override via env. */
const VC_HMAC_KEY = process.env.VC_HMAC_KEY ?? 'polis-vault-v1-test-key';
const VC_TTL_DAYS = Number(process.env.VC_TTL_DAYS ?? 90);

/** Recursive stable JSON stringifier (keys sorted at every depth). Mirrors the
 *  audit-service stableValue pattern — covers nested credentialSubject etc. */
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

function signVC(payload: object): string {
  const canonical = JSON.stringify(stableValue(payload));
  return createHmac('sha256', VC_HMAC_KEY).update(canonical).digest('hex');
}

async function emitAudit(event: {
  eventType: string;
  action: string;
  target: { type: string; id: string };
  data: Record<string, unknown>;
}): Promise<void> {
  const base = process.env.AUDIT_INTERNAL_URL ?? 'http://localhost:8600';
  try {
    await fetch(base + '/internal/audit/events', {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({
        eventType: event.eventType,
        action: event.action,
        visibility: 'public',
        actor: { type: 'service', id: 'vc-issuer-service' },
        target: event.target,
        data: event.data,
        correlationId: null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'vc-issuer-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Build the §15 VC-issuance route table bound to a DB client. */
export function vcRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('vc-issuer-service'),

    // Issue a test-key-signed VC for a proof-only / vc-presentation grant.
    // The VC NEVER carries document content — only proof manifest refs + verdict.
    {
      method: 'POST',
      path: '/internal/vc/issue',
      handler: async (_req, body) => {
        const input = body as {
          grantId?: string;
          proofManifestId?: string;
          manifestHash?: string;
          issuerName?: string;
          scope?: string;
        };
        if (!input.grantId) return result(400, { error: 'grant_id_required' });
        if (!input.proofManifestId || !input.manifestHash) {
          return result(400, { error: 'proof_manifest_required' });
        }

        const vcId = `vc-${randomBytes(8).toString('hex')}`;
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + VC_TTL_DAYS * 24 * 60 * 60 * 1000);

        const credentialSubject = {
          proofManifestId: input.proofManifestId,
          manifestHash: input.manifestHash,
          issuerName: input.issuerName ?? '',
          scope: input.scope ?? 'proof_only',
        };

        const proofPayload = {
          type: ['VerifiableCredential', 'PolisProofCredential'],
          issuer: { id: 'did:polis:test-key', name: 'polis-vault-v1' },
          credentialSubject,
          issuanceDate: now,
          expirationDate: expiresAt.toISOString(),
        };

        const vc = {
          ...proofPayload,
          proof: {
            type: 'Ed25519Signature2018', // test-key signal (M4 convention)
            created: now,
            proofPurpose: 'assertionMethod',
            verificationMethod: 'did:polis:test-key#key-1',
            proofValue: signVC(proofPayload),
          },
        };

        const ins = await db
          .insert(schema.verifiableCredentials)
          .values({
            id: vcId,
            grantId: input.grantId,
            vc,
            expiresAt,
          })
          .returning();

        await emitAudit({
          eventType: 'vc.issued',
          action: 'issue',
          target: { type: 'vc', id: vcId },
          data: { grantId: input.grantId, scope: input.scope },
        });

        return result(201, { id: ins[0].id, vc });
      },
    },

    // Verify a VC by id (used by grantee or acceptance to confirm the VC is valid).
    {
      method: 'GET',
      path: '/internal/vc/:id',
      handler: async (_req, _body, params) => {
        const rows = await db
          .select()
          .from(schema.verifiableCredentials)
          .where(eq(schema.verifiableCredentials.id, params.id))
          .limit(1);
        const vcRow = rows[0];
        if (!vcRow) return result(404, { error: 'not_found' });
        return result(200, { id: vcRow.id, vc: vcRow.vc, status: vcRow.status });
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8950);
  const db = getClient();
  startService('vc-issuer-service', port, vcRoutes(db));
  console.log(JSON.stringify({ service: 'vc-issuer-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

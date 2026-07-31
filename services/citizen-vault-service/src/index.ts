/**
 * @polis/citizen-vault-service — §16 citizen vault and access control (M8).
 *
 * Owns the `vault_documents`, `access_grants`, and `access_events` tables.
 * The BFF injects `X-Polis-Citizen:<id>` after verifying the session token
 * via citizen-identity-service /internal/identity/verify-session. Every
 * owner-facing route reads that header for authorization. The grantee verify
 * route is grant-scoped (no citizen session required); its structural leak
 * guard (proof_only/vc_presentation never yields document bytes) is the
 * security boundary — enforced in the handler, not a WHERE clause.
 *
 * §16.4: purpose-limitation mandatory, default time-limited, all access
 * audited, citizen can see who/what/when/why.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { getClient, schema } from '@polis/db';
import type { DbClient } from '@polis/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { internalHeaders, operationalRoutes, result, startService, type Route } from '@polis/service-runtime';

import { accessEventWire, accessGrantWire, vaultDocumentWire } from './serialize.js';

/** Default grant TTL when expiresAt is omitted (§16.4 "default time-limited"). */
const VAULT_DEFAULT_GRANT_TTL_DAYS = Number(process.env.VAULT_DEFAULT_GRANT_TTL_DAYS ?? 30);

/** §16.4 access rules: purpose limitation is mandatory. */
const GRANTEE_TYPES: Record<string, true> = {
  user: true,
  institution: true,
  system: true,
  partner: true,
};
function resolveCitizen(req: IncomingMessage): string | null {
  const raw = req.headers['x-polis-citizen'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
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
        actor: { type: 'service', id: 'citizen-vault-service' },
        target: event.target,
        data: event.data,
        correlationId: null,
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        service: 'citizen-vault-service',
        stage: 'audit-emit',
        warning: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/** Build the §16 vault route table bound to a DB client. */
export function vaultRoutes(db: DbClient): Route[] {
  return [
    ...operationalRoutes('citizen-vault-service'),

    // §16.2 owner adds a doc/proof to their vault.
    {
      method: 'POST',
      path: '/internal/vault/documents',
      handler: async (req, body) => {
        const citizenId = resolveCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const input = body as {
          documentId?: string;
          proofManifestId?: string;
          label?: string;
        };
        if (!input.label || !input.label.trim()) return result(400, { error: 'label_required' });
        if (!input.documentId && !input.proofManifestId) {
          return result(400, { error: 'document_or_proof_required' });
        }
        const ins = await db
          .insert(schema.vaultDocuments)
          .values({
            id: `vd-${randomBytes(8).toString('hex')}`,
            citizenId,
            documentId: input.documentId ?? null,
            proofManifestId: input.proofManifestId ?? null,
            label: input.label.trim(),
          })
          .returning();
        return result(201, vaultDocumentWire(ins[0]));
      },
    },

    // §16.2 owner lists their vault documents with proof status.
    {
      method: 'GET',
      path: '/internal/vault/documents',
      handler: async (req) => {
        const citizenId = resolveCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const rows = await db
          .select({
            vd: schema.vaultDocuments,
            manifestHash: schema.proofManifests.manifestHash,
            issuerName: schema.proofManifests.issuerName,
            registryStatus: schema.proofManifests.registryStatus,
          })
          .from(schema.vaultDocuments)
          .leftJoin(
            schema.proofManifests,
            eq(schema.vaultDocuments.proofManifestId, schema.proofManifests.id),
          )
          .where(eq(schema.vaultDocuments.citizenId, citizenId))
          .orderBy(desc(schema.vaultDocuments.addedAt));
        return {
          items: rows.map((r) =>
            vaultDocumentWire(
              r.vd,
              r.manifestHash
                ? {
                    manifestHash: r.manifestHash,
                    issuerName: r.issuerName ?? '',
                    registryStatus: r.registryStatus ?? '',
                  }
                : null,
            ),
          ),
        };
      },
    },

    // §16.3 owner creates an access grant.
    {
      method: 'POST',
      path: '/internal/vault/grants',
      handler: async (req, body) => {
        const citizenId = resolveCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const input = body as {
          grantee?: { type?: string; id?: string; name?: string };
          purpose?: string;
          scope?: string;
          vaultDocumentId?: string;
          expiresAt?: string;
        };
        const detail: string[] = [];
        if (!input.grantee?.type || !(input.grantee.type in GRANTEE_TYPES))
          detail.push('invalid_grantee_type');
        if (!input.grantee?.id) detail.push('grantee_id_required');
        if (!input.purpose || !input.purpose.trim()) detail.push('purpose_required');
        if (!input.scope || !(input.scope in GRANTEE_TYPES === false))
          detail.push('scope_required');
        // Validate scope ∈ ACCESS_GRANT_SCOPES (drizzle CHECK does this too, but
        // validate early for a clear 400 instead of a CHECK violation 500).
        const validScopes: Record<string, true> = {
          proof_only: true,
          metadata: true,
          redacted_content: true,
          full_content: true,
          vc_presentation: true,
        };
        if (!input.scope || !(input.scope in validScopes)) detail.push('invalid_scope');
        if (detail.length) return result(400, { error: 'invalid_grant', detail });

        // If a vaultDocumentId is given, verify the caller owns it.
        if (input.vaultDocumentId) {
          const vd = await db
            .select()
            .from(schema.vaultDocuments)
            .where(
              and(
                eq(schema.vaultDocuments.id, input.vaultDocumentId),
                eq(schema.vaultDocuments.citizenId, citizenId),
              ),
            )
            .limit(1);
          if (!vd[0]) return result(404, { error: 'vault_document_not_found' });
        }

        const expiresAt = input.expiresAt
          ? new Date(input.expiresAt)
          : new Date(Date.now() + VAULT_DEFAULT_GRANT_TTL_DAYS * 24 * 60 * 60 * 1000);

        const ins = await db
          .insert(schema.accessGrants)
          .values({
            id: `ag-${randomBytes(8).toString('hex')}`,
            granterId: citizenId,
            grantee: {
              type: input.grantee!.type,
              id: input.grantee!.id,
              name: input.grantee!.name ?? null,
            },
            purpose: input.purpose!.trim(),
            scope: input.scope!,
            vaultDocumentId: input.vaultDocumentId ?? null,
            expiresAt,
          })
          .returning();
        const grantRow = ins[0];

        // §16.4 access audit — visible to the citizen.
        await db.insert(schema.accessEvents).values({
          id: `ae-${randomBytes(8).toString('hex')}`,
          grantId: grantRow.id,
          event: 'grant',
          actorId: citizenId,
        });
        await emitAudit({
          eventType: 'vault.grant.created',
          action: 'grant',
          target: { type: 'vault_grant', id: grantRow.id },
          data: { granterId: citizenId, scope: input.scope, purpose: input.purpose },
        });
        return result(201, accessGrantWire(grantRow));
      },
    },

    // §16.3 owner revokes an access grant.
    {
      method: 'DELETE',
      path: '/internal/vault/grants/:id',
      handler: async (req, _body, params) => {
        const citizenId = resolveCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        const rows = await db
          .select()
          .from(schema.accessGrants)
          .where(eq(schema.accessGrants.id, params.id))
          .limit(1);
        const grant = rows[0];
        if (!grant) return result(404, { error: 'not_found' });
        if (grant.granterId !== citizenId) return result(403, { error: 'forbidden' });
        if (grant.status === 'revoked') return result(200, accessGrantWire(grant)); // idempotent
        const now = new Date();
        await db
          .update(schema.accessGrants)
          .set({ status: 'revoked', revokedAt: now })
          .where(eq(schema.accessGrants.id, params.id));
        await db.insert(schema.accessEvents).values({
          id: `ae-${randomBytes(8).toString('hex')}`,
          grantId: params.id,
          event: 'revoke',
          actorId: citizenId,
        });
        await emitAudit({
          eventType: 'vault.grant.revoked',
          action: 'revoke',
          target: { type: 'vault_grant', id: params.id },
          data: { granterId: citizenId },
        });
        return result(200, accessGrantWire({ ...grant, status: 'revoked', revokedAt: now }));
      },
    },

    // §16.4 owner sees their grants' access-event timeline.
    {
      method: 'GET',
      path: '/internal/vault/access-events',
      handler: async (req) => {
        const citizenId = resolveCitizen(req);
        if (!citizenId) return result(401, { error: 'unauthenticated' });
        // Load grants owned by this citizen, then fetch their access events.
        const grants = await db
          .select({ id: schema.accessGrants.id })
          .from(schema.accessGrants)
          .where(eq(schema.accessGrants.granterId, citizenId));
        const grantIds = grants.map((g) => g.id);
        if (!grantIds.length) return { items: [] };
        const events = await db
          .select()
          .from(schema.accessEvents)
          .where(inArray(schema.accessEvents.grantId, grantIds))
          .orderBy(desc(schema.accessEvents.at));
        return { items: events.map(accessEventWire) };
      },
    },

    // §30.9 / §16 grantee verify path (grant-scoped, no citizen session).
    // Structural leak guard: proof_only/vc_presentation NEVER yields document bytes.
    {
      method: 'POST',
      path: '/internal/vault/verify',
      handler: async (_req, body) => {
        const input = body as { grantId?: string };
        if (!input.grantId) return result(400, { error: 'grant_id_required' });
        const rows = await db
          .select()
          .from(schema.accessGrants)
          .where(eq(schema.accessGrants.id, input.grantId))
          .limit(1);
        const grant = rows[0];
        if (!grant) return result(404, { error: 'not_found' });

        const now = Date.now();
        // §16.4 access rules: active, started, not expired, not revoked.
        const notYetStarted = grant.startsAt instanceof Date && grant.startsAt.getTime() > now;
        const unexpired =
          !grant.expiresAt || (grant.expiresAt instanceof Date && grant.expiresAt.getTime() > now);
        if (
          grant.status !== 'active' ||
          notYetStarted ||
          !unexpired ||
          (grant.revokedAt && grant.revokedAt.getTime() <= now)
        ) {
          return result(403, { error: 'grant_not_active' });
        }

        // Build the verdict from the vault document + its proof manifest.
        // The structural leak guard lives here: for proof_only/vc_presentation
        // we never SELECT document bytes, url, ocr text, or manifest JSON content.
        let verdictData: Record<string, unknown> = { verdict: 'valid' };
        if (grant.vaultDocumentId) {
          const vdRows = await db
            .select({
              vd: schema.vaultDocuments,
              manifestHash: schema.proofManifests.manifestHash,
              issuerName: schema.proofManifests.issuerName,
              registryStatus: schema.proofManifests.registryStatus,
            })
            .from(schema.vaultDocuments)
            .leftJoin(
              schema.proofManifests,
              eq(schema.vaultDocuments.proofManifestId, schema.proofManifests.id),
            )
            .where(eq(schema.vaultDocuments.id, grant.vaultDocumentId))
            .limit(1);
          const vd = vdRows[0];
          if (vd) {
            verdictData = {
              verdict: vd.registryStatus === 'revoked' ? 'revoked' : 'valid',
              proofManifestId: vd.vd.proofManifestId,
              manifestHash: vd.manifestHash,
              issuerName: vd.issuerName,
            };
          } else {
            verdictData = { verdict: 'not_found' };
          }
        } else {
          verdictData = { verdict: 'scope_not_document' };
        }

        // §16.4 access audit — visible to the citizen.
        const grantee = grant.grantee as { type?: string; id?: string };
        await db.insert(schema.accessEvents).values({
          id: `ae-${randomBytes(8).toString('hex')}`,
          grantId: grant.id,
          event: 'access',
          actorId: grantee?.id ?? 'unknown',
        });
        await emitAudit({
          eventType: 'vault.access.used',
          action: 'access',
          target: { type: 'vault_grant', id: grant.id },
          data: { granteeId: grantee?.id, scope: grant.scope },
        });
        return result(200, verdictData);
      },
    },
  ];
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8750);
  const db = getClient();
  startService('citizen-vault-service', port, vaultRoutes(db));
  console.log(JSON.stringify({ service: 'citizen-vault-service', port, status: 'listening' }));
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) void main();

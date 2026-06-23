/**
 * Wire serializer for citizen-vault-service. DB rows are snake_case; this maps
 * to the §16 camelCase wire contract. Mirrors the per-service serializer
 * convention (services keep their own; cross-service src imports are not the
 * pattern). Proofs and document-detail rows are internal-only lookups; the
 * verify route's structural leak guard (proof_only never yields document bytes)
 * is enforced in the handler, not the serializer.
 */
import type { schema } from '@polis/db';

type VaultDocumentRow = (typeof schema.vaultDocuments)['$inferSelect'];
type AccessGrantRow = (typeof schema.accessGrants)['$inferSelect'];
type AccessEventRow = (typeof schema.accessEvents)['$inferSelect'];

export const vaultDocumentWire = (
  r: VaultDocumentRow,
  proof?: { manifestHash: string; issuerName: string; registryStatus: string } | null,
) => ({
  id: r.id,
  citizenId: r.citizenId,
  documentId: r.documentId,
  proofManifestId: r.proofManifestId,
  label: r.label,
  addedAt: r.addedAt.toISOString(),
  ...(proof
    ? {
        proof: {
          manifestHash: proof.manifestHash,
          issuerName: proof.issuerName,
          registryStatus: proof.registryStatus,
        },
      }
    : {}),
});

export const accessGrantWire = (r: AccessGrantRow) => ({
  id: r.id,
  granterId: r.granterId,
  grantee: r.grantee,
  purpose: r.purpose,
  scope: r.scope,
  vaultDocumentId: r.vaultDocumentId,
  startsAt: r.startsAt.toISOString(),
  expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  status: r.status,
  policyRef: r.policyRef,
  createdAt: r.createdAt.toISOString(),
});

export const accessEventWire = (r: AccessEventRow) => ({
  id: r.id,
  grantId: r.grantId,
  event: r.event,
  actorId: r.actorId,
  at: r.at.toISOString(),
});

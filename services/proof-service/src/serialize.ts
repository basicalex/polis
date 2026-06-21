/**
 * Wire serializer for proof-service. DB rows are snake_case; this maps to the
 * §15.2 DocumentProof camelCase wire type so the public contract has one home.
 * Mirrors polis-bridge-service/src/serialize.ts.
 */
import type { DocumentProof } from '@polis/domain';
import type { schema } from '@polis/db';

type ProofManifestRow = (typeof schema.proofManifests)['$inferSelect'];

export const documentProofWire = (r: ProofManifestRow): DocumentProof => ({
  id: r.id,
  schemaVersion: 'pi-doc-proof-v1',
  documentClass: r.documentClass,
  documentTypeId: r.documentTypeId,
  issuer: { id: r.issuerId, name: r.issuerName },
  hashes: {
    algorithm: r.algorithm as DocumentProof['hashes']['algorithm'],
    originalFileHash: r.originalFileHash,
    canonicalPdfHash: r.canonicalPdfHash,
    ocrTextHash: r.ocrTextHash,
    metadataHash: r.metadataHash,
    manifestHash: r.manifestHash,
  },
  originalFilename: r.originalFilename,
  originalMime: r.originalMime,
  originalBytes: r.originalBytes == null ? null : Number(r.originalBytes),
  registryStatus: r.registryStatus as DocumentProof['registryStatus'],
  contentVisibility: r.contentVisibility as DocumentProof['contentVisibility'],
  proofVisibility: r.proofVisibility as DocumentProof['proofVisibility'],
  createdAt: r.createdAt.toISOString(),
  createdByService: r.createdByService,
});

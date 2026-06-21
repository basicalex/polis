/**
 * Wire serializer for proof-service. DB rows are snake_case; this maps to the
 * §15.2 DocumentProof camelCase wire type so the public contract has one home.
 * Mirrors polis-bridge-service/src/serialize.ts.
 *
 * M4 additions: {@link documentProofWire} now assembles signature/timestamp/
 * supersession/revocation state onto every read, and derives the effective
 * registryStatus with precedence `revoked > superseded > active` (a proof
 * with both a revocation and a supersession reports `revoked`, but
 * `supersededBy` stays populated for linkage). {@link mapSignature} /
 * {@link mapTimestamp} are the local snake_case → camelCase mappers for the
 * child-table rows joined onto a proof read — they duplicate the sibling
 * services' serializers because cross-service src imports are not an
 * established pattern (services ship `dist/index.js` as `main`).
 */
import type { DocumentProof, ProofSignature, ProofTimestamp } from '@polis/domain';
import type { schema } from '@polis/db';

type ProofManifestRow = (typeof schema.proofManifests)['$inferSelect'];
type ProofSignatureRow = (typeof schema.proofSignatures)['$inferSelect'];
type ProofTimestampRow = (typeof schema.proofTimestamps)['$inferSelect'];

export type SupersessionView = { supersededBy: string; supersededAt: string } | null;
export type RevocationView = { revokedAt: string; reason: string | null } | null;

export const mapSignature = (r: ProofSignatureRow): ProofSignature => ({
  id: r.id,
  type: r.type as ProofSignature['type'],
  standard: r.standard as ProofSignature['standard'],
  signerRef: r.signerRef,
  certificateRef: r.certificateRef,
  signatureValueRef: r.signatureValueRef,
  signedHash: r.signedHash,
  signedAt: r.signedAt ? r.signedAt.toISOString() : null,
  validationStatus: r.validationStatus as ProofSignature['validationStatus'],
  issuerId: r.issuerId,
});

export const mapTimestamp = (r: ProofTimestampRow): ProofTimestamp => ({
  id: r.id,
  type: r.type as ProofTimestamp['type'],
  timestampRef: r.timestampRef,
  timestampedHash: r.timestampedHash,
  timestampedAt: r.timestampedAt.toISOString(),
  validationStatus: r.validationStatus as ProofTimestamp['validationStatus'],
  tsa: r.tsa,
  clockSource: r.clockSource,
});

export const documentProofWire = (
  r: ProofManifestRow,
  signatures: ProofSignature[],
  timestamps: ProofTimestamp[],
  supersession: SupersessionView,
  revocation: RevocationView,
): DocumentProof => ({
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
  registryStatus: revocation
    ? 'revoked'
    : supersession
      ? 'superseded'
      : (r.registryStatus as DocumentProof['registryStatus']),
  contentVisibility: r.contentVisibility as DocumentProof['contentVisibility'],
  proofVisibility: r.proofVisibility as DocumentProof['proofVisibility'],
  createdAt: r.createdAt.toISOString(),
  createdByService: r.createdByService,
  signatures,
  timestamps,
  supersededBy: supersession?.supersededBy ?? null,
  supersededAt: supersession?.supersededAt ?? null,
});

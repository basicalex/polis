/**
 * Wire serializer for signature-service. DB rows are snake_case; this maps to
 * the §15.2 ProofSignature camelCase wire type so the public contract has one
 * home. Mirrors proof-service/src/serialize.ts.
 */
import type { ProofSignature } from '@polis/domain';
import type { schema } from '@polis/db';

type ProofSignatureRow = (typeof schema.proofSignatures)['$inferSelect'];

export const proofSignatureWire = (r: ProofSignatureRow): ProofSignature => ({
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

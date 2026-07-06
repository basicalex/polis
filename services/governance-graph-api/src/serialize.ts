/**
 * Wire serializers for governance-graph-api. DB rows are snake_case; these map
 * to the camelCase wire objects consumed by the public BFF edge (§23) and the
 * web client. This module OWNS these wire type names (import them here, never
 * via `ReturnType<typeof>` at consumers).
 */
import type { schema } from '@polis/db';

type Row<T extends keyof typeof schema> = (typeof schema)[T] extends never
  ? never
  : (typeof schema)[T]['$inferSelect'];

type JurisdictionRow = Row<'jurisdictions'>;
type InstitutionRow = Row<'institutions'>;
type RoleRow = Row<'roles'>;
type MandateRow = Row<'mandates'>;
type ProcessRow = Row<'processes'>;
type ProcessStepRow = Row<'processSteps'>;
type DocumentTypeRow = Row<'documentTypes'>;
type FailureModeRow = Row<'failureModes'>;
type ClaimRow = Row<'claims'>;
type EvidenceLinkRow = Row<'evidenceLinks'>;
type EvidenceLinkRowWithVisibility = EvidenceLinkRow & { visibility?: string | null };
type SourceRow = Row<'sources'>;
type RelationshipRow = Row<'relationships'>;
type MandateHolderRow = Row<'mandateHolders'>;
type MandateHolderCharterRow = Row<'mandateHolderCharters'>;
type CommitmentRow = Row<'commitments'>;
type CommitmentStatusEventRow = Row<'commitmentStatusEvents'>;
type CommitmentQuestionRow = Row<'commitmentQuestions'>;
type CommitmentAnswerRow = Row<'commitmentAnswers'>;

export interface JurisdictionWire {
  id: string;
  name: string;
  slug: string;
  jurisdictionPath: string;
  description: string | null;
  confidenceState: string;
  reviewState: string;
  visibility: string;
}

export interface InstitutionWire {
  id: string;
  name: string;
  jurisdictionId: string | null;
  description: string | null;
  confidenceState: string;
  reviewState: string;
  visibility: string;
}

export interface RoleWire {
  id: string;
  name: string;
  institutionId: string | null;
  mandate: {
    id: string;
    name: string;
    description: string | null;
    legalBasis: string | null;
  } | null;
  authorizedByLaw: string | null;
  decisionRights: string[];
  description: string | null;
  confidenceState: string;
  reviewState: string;
  visibility: string;
}

export interface ProcessStepWire {
  id: string;
  processId: string | null;
  ordinal: string | null;
  name: string;
  description: string | null;
}

export interface DocumentTypeWire {
  id: string;
  name: string;
  jurisdictionId: string | null;
  legalBasis: string | null;
  description: string | null;
}

export interface ProcessWire {
  id: string;
  name: string;
  need: string | null;
  legalBasis: string | null;
  steps: ProcessStepWire[];
  requiredDocuments: DocumentTypeWire[];
  failureModes: { id: string; name: string; description: string | null }[];
  confidenceState: string;
  reviewState: string;
  visibility: string;
}

export interface EvidenceLinkWire {
  id: string;
  claimId: string;
  sourceId: string;
  locator: Record<string, unknown> | null;
  quote: string | null;
  paraphrase: string | null;
  sourceHash: string | null;
  retrievedAt: string | null;
  confidence: string;
  visibility: string;
  redacted?: boolean;
  redactionReason?: string;
}

export interface SourceWire {
  id: string;
  title: string;
  url: string | null;
  sourceType: string | null;
  publisher: string | null;
  publishedAt: string | null;
}

export interface ClaimWire {
  id: string;
  text: string;
  claimType: string;
  subjectType: string;
  subjectId: string;
  confidence: string;
  confidenceState: string;
  reviewState: string;
  visibility: string;
  methodVersion: string | null;
  evidence: EvidenceLinkWire[];
  sources: SourceWire[];
}

export interface RelationshipWire {
  id: string;
  relationshipType: string;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  confidenceState: string;
  reviewState: string;
  visibility: string;
}

export interface MandateHolderWire {
  id: string;
  citizenId: string;
  roleId: string | null;
  jurisdictionId: string | null;
  displayName: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
}

export interface MandateHolderCharterWire {
  id: string;
  mandateHolderId: string;
  charterDoc: unknown | null;
  status: string;
}
export interface CommitmentAnswerWire {
  mandateHolderId: string;
  body: string;
  decidedAt: string | null;
}

export interface CommitmentQuestionWire {
  id: string;
  commitmentId: string;
  askedByCitizenId: string;
  body: string;
  createdAt: string;
  answer: CommitmentAnswerWire | null;
}


export interface CommitmentWire {
  id: string;
  claimId: string;
  mandateHolderId: string;
  processId: string | null;
  jurisdictionId: string | null;
  successCriterion: string;
  dueAt: string | null;
}

export interface CommitmentStatusEventWire {
  id: string;
  commitmentId: string;
  status: string;
  resolutionClaimId: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

const ns = (t: Date | string | null): string | null => (t ? new Date(t).toISOString() : null);

export const jurisdictionWire = (r: JurisdictionRow): JurisdictionWire => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  jurisdictionPath: r.jurisdictionPath,
  description: r.description,
  confidenceState: r.confidenceState,
  reviewState: r.reviewState,
  visibility: r.visibility,
});

export const institutionWire = (r: InstitutionRow): InstitutionWire => ({
  id: r.id,
  name: r.name,
  jurisdictionId: r.jurisdictionId,
  description: r.description,
  confidenceState: r.confidenceState,
  reviewState: r.reviewState,
  visibility: r.visibility,
});

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export const roleWire = (r: RoleRow, mandate: MandateRow | null): RoleWire => ({
  id: r.id,
  name: r.name,
  institutionId: r.institutionId,
  mandate: mandate
    ? {
        id: mandate.id,
        name: mandate.name,
        description: mandate.description,
        legalBasis: mandate.legalBasis,
      }
    : null,
  authorizedByLaw: r.authorizedByLaw,
  decisionRights: asStringArray(r.decisionRights),
  description: r.description,
  confidenceState: r.confidenceState,
  reviewState: r.reviewState,
  visibility: r.visibility,
});

export const processStepWire = (r: ProcessStepRow): ProcessStepWire => ({
  id: r.id,
  processId: r.processId,
  ordinal: r.ordinal,
  name: r.name,
  description: r.description,
});

export const documentTypeWire = (r: DocumentTypeRow): DocumentTypeWire => ({
  id: r.id,
  name: r.name,
  jurisdictionId: r.jurisdictionId,
  legalBasis: r.legalBasis,
  description: r.description,
});

export const failureModeWire = (r: FailureModeRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
});

const isPublicEvidenceVisibility = (visibility: string | null): boolean => visibility === 'public';

const evidenceVisibility = (r: EvidenceLinkRowWithVisibility): string => r.visibility ?? 'public';

export const evidenceLinkWire = (r: EvidenceLinkRow): EvidenceLinkWire => {
  const visibility = evidenceVisibility(r);
  const base = {
    id: r.id,
    claimId: r.claimId,
    sourceId: r.sourceId,
    retrievedAt: ns(r.retrievedAt),
    confidence: r.confidence,
    visibility,
  };

  if (isPublicEvidenceVisibility(visibility)) {
    return {
      ...base,
      locator: (r.locator as Record<string, unknown> | null) ?? null,
      quote: r.quote,
      paraphrase: r.paraphrase,
      sourceHash: r.sourceHash,
    };
  }

  return {
    ...base,
    locator: null,
    quote: null,
    paraphrase: null,
    sourceHash: null,
    redacted: true,
    redactionReason: 'evidence_visibility',
  };
};

export const sourceWire = (r: SourceRow): SourceWire => ({
  id: r.id,
  title: r.title,
  url: r.url,
  sourceType: r.sourceType,
  publisher: r.publisher,
  publishedAt: ns(r.publishedAt),
});

export const claimWire = (
  r: ClaimRow,
  evidence: EvidenceLinkWire[],
  sources: SourceWire[],
): ClaimWire => ({
  id: r.id,
  text: r.text,
  claimType: r.claimType,
  subjectType: r.subjectType,
  subjectId: r.subjectId,
  confidence: r.confidence,
  confidenceState: r.confidenceState,
  reviewState: r.reviewState,
  visibility: r.visibility,
  methodVersion: r.methodVersion,
  evidence,
  sources,
});

export const relationshipWire = (r: RelationshipRow): RelationshipWire => ({
  id: r.id,
  relationshipType: r.relationshipType,
  fromEntityType: r.fromEntityType,
  fromEntityId: r.fromEntityId,
  toEntityType: r.toEntityType,
  toEntityId: r.toEntityId,
  confidenceState: r.confidenceState,
  reviewState: r.reviewState,
  visibility: r.visibility,
});

export const processWire = (
  r: ProcessRow,
  steps: ProcessStepWire[],
  requiredDocuments: DocumentTypeWire[],
  failureModes: { id: string; name: string; description: string | null }[],
): ProcessWire => ({
  id: r.id,
  name: r.name,
  need: r.need,
  legalBasis: r.legalBasis,
  steps,
  requiredDocuments,
  failureModes,
  confidenceState: r.confidenceState,
  reviewState: r.reviewState,
  visibility: r.visibility,
});

export const mandateHolderWire = (r: MandateHolderRow): MandateHolderWire => ({
  id: r.id,
  citizenId: r.citizenId,
  roleId: r.roleId,
  jurisdictionId: r.jurisdictionId,
  displayName: r.displayName,
  startsAt: ns(r.startsAt) ?? '',
  endsAt: ns(r.endsAt),
  status: r.status,
});

export const mandateHolderCharterWire = (r: MandateHolderCharterRow): MandateHolderCharterWire => ({
  id: r.id,
  mandateHolderId: r.mandateHolderId,
  charterDoc: r.charterDoc ?? null,
  status: r.status,
});

export const commitmentWire = (r: CommitmentRow): CommitmentWire => ({
  id: r.id,
  claimId: r.claimId,
  mandateHolderId: r.mandateHolderId,
  processId: r.processId,
  jurisdictionId: r.jurisdictionId,
  successCriterion: r.successCriterion,
  dueAt: ns(r.dueAt),
});

export const commitmentStatusEventWire = (
  r: CommitmentStatusEventRow,
): CommitmentStatusEventWire => ({
  id: r.id,
  commitmentId: r.commitmentId,
  status: r.status,
  resolutionClaimId: r.resolutionClaimId,
  decidedBy: r.decidedBy,
  decidedAt: ns(r.decidedAt) ?? '',
});

export const commitmentQuestionWire = (
  q: CommitmentQuestionRow,
  answer: CommitmentAnswerRow | null,
): CommitmentQuestionWire => ({
  id: q.id,
  commitmentId: q.commitmentId,
  askedByCitizenId: q.askedByCitizenId,
  body: q.body,
  createdAt: ns(q.createdAt) ?? '',
  answer: answer
    ? {
        mandateHolderId: answer.mandateHolderId,
        body: answer.body,
        decidedAt: ns(answer.decidedAt),
      }
    : null,
});

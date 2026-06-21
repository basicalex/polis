export type ReviewState =
  | 'draft'
  | 'submitted'
  | 'needs_revision'
  | 'under_review'
  | 'approved'
  | 'contested'
  | 'deprecated'
  | 'rejected'
  | 'archived';
export type Visibility = 'public' | 'private' | 'restricted' | 'redacted' | 'sealed' | 'internal';
export type ConfidenceState =
  | 'unsupported_draft'
  | 'single_source'
  | 'multi_source'
  | 'official_source'
  | 'official_confirmed'
  | 'expert_reviewed'
  | 'contested'
  | 'outdated'
  | 'superseded';
export type RelationshipType =
  | 'JURISDICTION_HAS_INSTITUTION'
  | 'INSTITUTION_HAS_ROLE'
  | 'ROLE_AUTHORIZED_BY_LAW'
  | 'ROLE_HAS_MANDATE'
  | 'ROLE_CONTROLS_DECISION_RIGHT'
  | 'ROLE_PARTICIPATES_IN_PROCESS'
  | 'PROCESS_HAS_STEP'
  | 'STEP_REQUIRES_DOCUMENT_TYPE'
  | 'INSTITUTION_ISSUES_DOCUMENT_TYPE'
  | 'LAW_AUTHORIZES_DOCUMENT_TYPE'
  | 'BUDGET_FUNDS_INSTITUTION'
  | 'BUDGET_FUNDS_PROGRAM'
  | 'PROCESS_CREATES_FAILURE_MODE'
  | 'FAILURE_MODE_MITIGATED_BY_CONTROL'
  | 'PROPOSAL_CHANGES_PROCESS'
  | 'PROPOSAL_REDUCES_FAILURE_MODE'
  | 'PROPOSAL_INTRODUCES_RISK'
  | 'CLAIM_SUPPORTED_BY_SOURCE'
  | 'DOCUMENT_PROOF_LINKS_TO_DOCUMENT_TYPE'
  | 'POLIS_CONVERSATION_DELIBERATES_ISSUE'
  | 'CONSENSUS_CLUSTER_SUPPORTS_PROPOSAL';
export type IssueStatus = 'open' | 'deliberating' | 'resolved' | 'archived';
export type ConversationStatus = 'draft' | 'active' | 'closed' | 'reported' | 'archived'; // §13.5 verbatim
export type ParticipationMode = 'open' | 'pseudonymous' | 'verified' | 'partner_restricted'; // §13.5 verbatim

export type Issue = {
  id: string;
  jurisdictionId: string | null;
  processId: string | null;
  slug: string;
  title: string;
  summary: string | null;
  status: IssueStatus;
  createdAt: string;
};

export type PolisConversation = {
  id: string;
  externalPolisId: string;
  issueId: string;
  title: string;
  framingQuestion: string;
  participationMode: ParticipationMode;
  status: ConversationStatus;
  reportUrl: string | null;
  createdAt: string;
  closedAt: string | null;
};

export type ConversationResult = {
  id: string;
  conversationId: string;
  consensusGroups: unknown | null; // §13.4 report snapshot jsonb
  participantCount: number | null;
  capturedAt: string;
};
export type EvidenceLink = {
  id: string;
  sourceId: string;
  locator?: {
    page?: number;
    lineStart?: number;
    lineEnd?: number;
    xpath?: string;
    tableCell?: string;
    timestamp?: string;
  };
  quote?: string;
  paraphrase?: string;
  sourceHash?: string;
  retrievedAt?: string;
  confidence: number;
};
export type Claim = {
  id: string;
  text: string;
  claimType:
    | 'legal_mandate'
    | 'budget_amount'
    | 'role_responsibility'
    | 'process_step'
    | 'document_requirement'
    | 'risk_assessment'
    | 'proposal_assertion'
    | 'public_statement'
    | 'other';
  subjectType: string;
  subjectId: string;
  evidence: EvidenceLink[];
  confidence: number;
  reviewState: ReviewState;
  createdBy: string;
  createdAt: string;
  methodVersion?: string;
  aiTraceId?: string;
};
export type Institution = {
  id: string;
  name: string;
  jurisdiction: string;
  description: string;
  confidenceState: ConfidenceState;
  reviewState: ReviewState;
  evidence: EvidenceLink[];
};
export type GovernanceProcess = {
  id: string;
  name: string;
  need: string;
  legalBasis: string;
  steps: string[];
  documentTypes: string[];
  failureModes: string[];
  simplificationCandidates: string[];
  reviewState: ReviewState;
};
export type ProofManifest = {
  id: string;
  schemaVersion: 'pi-doc-proof-v1';
  documentHash: string;
  algorithm: 'sha256' | 'sha512' | 'blake3';
  visibility: Visibility;
  status: 'active' | 'revoked' | 'superseded';
  issuer: string;
  createdAt: string;
  signatures: string[];
  timestamps: string[];
  anchors: string[];
  provenance: string[];
};
export type DocumentProof = {
  id: string;
  schemaVersion: 'pi-doc-proof-v1';
  documentClass: string;
  documentTypeId: string | null;
  issuer: { id: string; name: string };
  hashes: {
    algorithm: 'sha256' | 'sha512' | 'blake3';
    originalFileHash: string;
    canonicalPdfHash: string | null;
    ocrTextHash: string | null;
    metadataHash: string | null;
    manifestHash: string;
  };
  originalFilename: string | null;
  originalMime: string | null;
  originalBytes: number | null;
  registryStatus: 'active' | 'superseded' | 'revoked' | 'expired' | 'sealed' | 'unknown';
  contentVisibility: 'public' | 'private' | 'restricted' | 'redacted' | 'sealed';
  proofVisibility: 'public' | 'restricted' | 'private' | 'commitment_only';
  createdAt: string;
  createdByService: string | null;
  signatures: ProofSignature[];
  timestamps: ProofTimestamp[];
  supersededBy: string | null;
  supersededAt: string | null;
};
export type ProofSignature = {
  id: string;
  type: 'citizen-signature' | 'official-signature' | 'institutional-seal';
  standard: 'eIDAS-QES' | 'eIDAS-AdES' | 'eIDAS-eSeal' | 'test-key' | 'other';
  signerRef: string;
  certificateRef: string | null;
  signatureValueRef: string;
  signedHash: string;
  signedAt: string | null;
  validationStatus: 'valid' | 'invalid' | 'indeterminate' | 'not_checked';
  issuerId: string | null;
};

export type ProofTimestamp = {
  id: string;
  type: 'RFC3161' | 'eIDAS-qualified-timestamp' | 'blockchain-anchor' | 'internal-test';
  timestampRef: string;
  timestampedHash: string;
  timestampedAt: string;
  validationStatus: 'valid' | 'invalid' | 'indeterminate' | 'not_checked';
  tsa: string | null;
  clockSource: string | null;
};
export type Assessment = {
  subjectId: string;
  methodVersion: string;
  dimensions: Record<
    'efficacy' | 'safety' | 'hardness' | 'reliability' | 'legitimacy',
    { score: number; confidence: number; rationale: string }
  >;
  reviewState: ReviewState;
};
export type AuditEvent = {
  id: string;
  service: string;
  action: string;
  subjectId: string;
  visibility: Visibility;
  createdAt: string;
  hashPrevious?: string;
  hmac?: string;
  redacted: boolean;
};
export const demoEvidence: EvidenceLink = {
  id: 'ev-demo-law',
  sourceId: 'src-demo-municipality',
  quote: 'Demo public complaints office receives and routes citizen complaints.',
  confidence: 0.8,
  retrievedAt: '2026-06-08T00:00:00.000Z',
};
export const demoInstitution: Institution = {
  id: 'inst-demo-complaints-office',
  name: 'Demo Public Complaints Office',
  jurisdiction: 'HR/local-demo',
  description:
    'Routes citizen complaints, requests supporting documents, and publishes aggregate service metrics.',
  confidenceState: 'official_source',
  reviewState: 'approved',
  evidence: [demoEvidence],
};
export const demoProcess: GovernanceProcess = {
  id: 'process-public-complaint',
  name: 'Submit a public service complaint',
  need: 'A citizen needs a traceable complaint path when a service fails.',
  legalBasis: 'Demo municipal service charter',
  steps: [
    'Identify responsible office',
    'Submit complaint and evidence',
    'Receive case number',
    'Office reviews response',
    'Citizen can appeal',
  ],
  documentTypes: ['identity-proof', 'complaint-form', 'supporting-evidence'],
  failureModes: ['unclear responsibility', 'paper courier burden', 'missing appeal trace'],
  simplificationCandidates: [
    'hash-only evidence sharing',
    'public status receipt',
    'single responsible role page',
  ],
  reviewState: 'approved',
};
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}
export function assessProcess(p: GovernanceProcess): Assessment {
  const burden = Math.min(1, p.steps.length / 10);
  const controls = p.simplificationCandidates.length / 5;
  return {
    subjectId: p.id,
    methodVersion: 'governance-assessment-v1',
    reviewState: 'under_review',
    dimensions: {
      efficacy: {
        score: clampScore(1 - burden / 2),
        confidence: 0.7,
        rationale: 'Shorter, traceable process improves efficacy.',
      },
      safety: {
        score: 0.75,
        confidence: 0.65,
        rationale: 'Human appeal and evidence review preserve safety.',
      },
      hardness: {
        score: clampScore(0.5 + controls / 2),
        confidence: 0.6,
        rationale: 'More controls reduce capture and ambiguity.',
      },
      reliability: {
        score: 0.7,
        confidence: 0.6,
        rationale: 'Case numbers and audit events make state transitions observable.',
      },
      legitimacy: {
        score: 0.8,
        confidence: 0.7,
        rationale: 'Public evidence and appeal path support legitimacy.',
      },
    },
  };
}
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data =
    typeof bytes === 'string'
      ? new TextEncoder().encode(bytes)
      : new Uint8Array(bytes).slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function createProofManifest(
  input: string,
  visibility: Visibility = 'private',
): Promise<ProofManifest> {
  return {
    id: `proof-${await sha256Hex(input).then((h) => h.slice(0, 16))}`,
    schemaVersion: 'pi-doc-proof-v1',
    documentHash: await sha256Hex(input),
    algorithm: 'sha256',
    visibility,
    status: 'active',
    issuer: 'Polis Interface Demo Authority',
    createdAt: new Date(0).toISOString(),
    signatures: ['mock-signature-local-v1'],
    timestamps: ['mock-rfc3161-token-v1'],
    anchors: ['mock-merkle-anchor-v1'],
    provenance: ['created-by-document-proof-service'],
  };
}
export function verifyProof(manifest: ProofManifest, hash: string) {
  const ok = manifest.documentHash === hash && manifest.status === 'active';
  return {
    ok,
    status: manifest.status,
    visibility: manifest.visibility,
    technical: {
      algorithm: manifest.algorithm,
      signatures: manifest.signatures,
      timestamps: manifest.timestamps,
      anchors: manifest.anchors,
    },
  };
}
export const demoClaims: Claim[] = [
  {
    id: 'claim-demo-office-role',
    text: 'The complaints office is responsible for receiving local public service complaints.',
    claimType: 'role_responsibility',
    subjectType: 'institution',
    subjectId: demoInstitution.id,
    evidence: [demoEvidence],
    confidence: 0.8,
    reviewState: 'approved',
    createdBy: 'dev-seed',
    createdAt: '2026-06-08T00:00:00.000Z',
    methodVersion: 'evidence-v1',
  },
];

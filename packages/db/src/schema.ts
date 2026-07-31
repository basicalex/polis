/**
 * Drizzle schema — the canonical source of truth for the Polis Interface DB.
 *
 * Conventions (project-wide, ADR-004):
 *   - Column names are snake_case (`created_at`, `review_state`).
 *   - Wire objects (TS/Python) are camelCase; mappers live at service boundaries.
 *   - Enums are CHECK constraints using the exact value sets from the spec
 *     (§11/§12/§15/§21/§26.3).
 *   - Migrations are generated DDL, committed, and language-agnostic.
 *
 * Phase 0 (0000_baseline): app_meta key/value.
 * Phase 1 (0001_governance_v0): governance ontology + graph + evidence + audit.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* Enum value sets (canonical; mirror @polis/domain wire types)        */
/* ------------------------------------------------------------------ */

export const REVIEW_STATES = [
  'draft',
  'submitted',
  'needs_revision',
  'under_review',
  'approved',
  'contested',
  'deprecated',
  'rejected',
  'archived',
] as const;

export const VISIBILITIES = [
  'public',
  'private',
  'restricted',
  'redacted',
  'sealed',
  'internal',
] as const;

export const EVIDENCE_LINK_VISIBILITIES = ['public', 'restricted', 'private'] as const;

export const CONFIDENCE_STATES = [
  'unsupported_draft',
  'single_source',
  'multi_source',
  'official_source',
  'official_confirmed',
  'expert_reviewed',
  'contested',
  'outdated',
  'superseded',
] as const;

export const CLAIM_TYPES = [
  'legal_mandate',
  'budget_amount',
  'role_responsibility',
  'process_step',
  'document_requirement',
  'risk_assessment',
  'proposal_assertion',
  'public_statement',
  'other',
] as const;

export const ACTOR_TYPES = ['user', 'service', 'system', 'partner'] as const;

export const RELATIONSHIP_TYPES = [
  'JURISDICTION_HAS_INSTITUTION',
  'INSTITUTION_HAS_ROLE',
  'ROLE_AUTHORIZED_BY_LAW',
  'ROLE_HAS_MANDATE',
  'ROLE_CONTROLS_DECISION_RIGHT',
  'ROLE_PARTICIPATES_IN_PROCESS',
  'PROCESS_HAS_STEP',
  'STEP_REQUIRES_DOCUMENT_TYPE',
  'INSTITUTION_ISSUES_DOCUMENT_TYPE',
  'LAW_AUTHORIZES_DOCUMENT_TYPE',
  'BUDGET_FUNDS_INSTITUTION',
  'BUDGET_FUNDS_PROGRAM',
  'PROCESS_CREATES_FAILURE_MODE',
  'FAILURE_MODE_MITIGATED_BY_CONTROL',
  'PROPOSAL_CHANGES_PROCESS',
  'PROPOSAL_REDUCES_FAILURE_MODE',
  'PROPOSAL_INTRODUCES_RISK',
  'CLAIM_SUPPORTED_BY_SOURCE',
  'DOCUMENT_PROOF_LINKS_TO_DOCUMENT_TYPE',
  'POLIS_CONVERSATION_DELIBERATES_ISSUE',
  'CONSENSUS_CLUSTER_SUPPORTS_PROPOSAL',
] as const;
export const ISSUE_STATUSES = ['open', 'deliberating', 'resolved', 'archived'] as const;
export const CONVERSATION_STATUSES = ['draft', 'active', 'closed', 'reported', 'archived'] as const;
export const PARTICIPATION_MODES = [
  'open',
  'pseudonymous',
  'verified',
  'partner_restricted',
] as const;
// §14.4/§14.5/§14.6/§15.2/§15.5 value sets for the document-proof pipeline.
export const DOCUMENT_CLASSES = [
  'public-government-record',
  'citizen-private-document',
  'restricted-administrative-record',
  'open-data-publication',
  'court-or-legal-record',
  'tax-or-accounting-record',
  'internal-draft',
  'redacted-public-derivative',
] as const;
export const CONTENT_VISIBILITIES = [
  'public',
  'private',
  'restricted',
  'redacted',
  'sealed',
] as const;
export const PROOF_VISIBILITIES = ['public', 'restricted', 'private', 'commitment_only'] as const;
export const PROOF_REGISTRY_STATUSES = [
  'active',
  'superseded',
  'revoked',
  'expired',
  'sealed',
  'unknown',
] as const;
export const PROOF_ALGORITHMS = ['sha256', 'sha512', 'blake3'] as const;
export const SIGNATURE_TYPES = [
  'citizen-signature',
  'official-signature',
  'institutional-seal',
] as const;
export const SIGNATURE_STANDARDS = [
  'eIDAS-QES',
  'eIDAS-AdES',
  'eIDAS-eSeal',
  'test-key',
  'other',
] as const;
export const VALIDATION_STATUSES = ['valid', 'invalid', 'indeterminate', 'not_checked'] as const;
export const TIMESTAMP_TYPES = [
  'RFC3161',
  'eIDAS-qualified-timestamp',
  'blockchain-anchor',
  'internal-test',
] as const;
export const AI_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const IDENTITY_LEVELS = ['anonymous', 'casual', 'verified', 'enrolled', 'staff'] as const;
export const SUBMISSION_TYPES = ['evidence', 'graph_edit', 'claim'] as const;
export const SUBMISSION_STATUSES = ['pending', 'in_review', 'approved', 'rejected'] as const;
export const GRAPH_PROPOSAL_OPS = ['insert', 'update', 'delete'] as const;
export const REVIEW_DECISIONS = ['approved', 'rejected'] as const;
export const REWARD_ELIGIBILITY_OUTCOMES = ['eligible', 'denied'] as const;
export const PAYOUT_STATUSES = ['pending', 'paid'] as const;
export const IDENTITY_AUTH_LEVELS = ['verified_resident', 'verified_official', 'staff'] as const; // §21.1 vault-eligible tiers (v1)
export const ACCESS_GRANT_SCOPES = [
  'proof_only',
  'metadata',
  'redacted_content',
  'full_content',
  'vc_presentation',
] as const;
export const ACCESS_GRANT_STATUSES = ['active', 'expired', 'revoked', 'pending'] as const;
export const ACCESS_EVENT_TYPES = ['grant', 'access', 'revoke'] as const;
export const VC_STATUSES = ['active', 'expired', 'revoked'] as const;
export const MANDATE_HOLDER_STATUSES = ['active', 'ended', 'revoked'] as const;
export const COMMITMENT_STATUSES = [
  'proposed',
  'in_progress',
  'delivered',
  'partial',
  'not_delivered',
  'overdue',
] as const;
export const CHARTER_STATUSES = ['pending', 'accepted', 'withdrawn'] as const;
export const DOCUMENT_ARTIFACT_KINDS = [
  'charter_unsigned',
  'charter_signed',
  'provider_receipt',
] as const;
export const DOCUMENT_ARTIFACT_STORAGE_MODES = ['database', 's3'] as const;
export const SIGNING_PROVIDERS = ['stub', 'documenso'] as const;
export const SIGNING_REQUEST_STATUSES = [
  'created',
  'distributed',
  'awaiting_signatures',
  'completed',
  'declined',
  'expired',
  'voided',
  'failed',
] as const;
export const SIGNING_RECIPIENT_ROLES = ['signer', 'approver', 'witness'] as const;
export const SIGNING_RECIPIENT_STATUSES = [
  'pending',
  'sent',
  'opened',
  'signed',
  'declined',
] as const;
export const MANDATE_HOLDER_CHARTER_EVENTS = [
  'initiated',
  'distributed',
  'completed',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
] as const;

/** Build a CHECK constraint restricting `column` to the given value set. */
function enumCheck(name: string, column: string, values: readonly string[]) {
  const list = values.map((v) => `'${v}'`).join(',');
  return check(name, sql.raw(`${column} in (${list})`));
}

/* ------------------------------------------------------------------ */
/* Shared column helpers                                               */
/* ------------------------------------------------------------------ */

/** Primary-key id (semantic text ids from seed, e.g. 'inst-complaints-office'). */
const pkId = () => text('id').primaryKey();

/** Audit/ownership columns common to governance + evidence tables. */
const universal = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: text('created_by_user_id'),
  updatedByUserId: text('updated_by_user_id'),
  status: text('status'),
  auditCorrelationId: text('audit_correlation_id'),
});

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

/* ------------------------------------------------------------------ */
/* Phase 0 baseline                                                    */
/* ------------------------------------------------------------------ */

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Governance ontology (§11)                                          */
/* ------------------------------------------------------------------ */

export const jurisdictions = pgTable(
  'jurisdictions',
  {
    id: pkId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    jurisdictionPath: text('jurisdiction_path').notNull(), // e.g. "HR/local"
    description: text('description'),
    confidenceState: text('confidence_state').notNull().default('official_source'),
    reviewState: text('review_state').notNull().default('approved'),
    visibility: text('visibility').notNull().default('public'),
    ...universal(),
  },
  (t) => [
    uniqueIndex('jurisdictions_slug_idx').on(t.slug),
    enumCheck('ck_jurisdictions_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_jurisdictions_review', 'review_state', REVIEW_STATES),
    enumCheck('ck_jurisdictions_visibility', 'visibility', VISIBILITIES),
  ],
);

export const mandates = pgTable('mandates', {
  id: pkId(),
  name: text('name').notNull(),
  description: text('description'),
  legalBasis: text('legal_basis'),
  ...universal(),
});

export const laws = pgTable('laws', {
  id: pkId(),
  citation: text('citation').notNull(),
  title: text('title'),
  jurisdictionId: text('jurisdiction_id'),
  url: text('url'),
  ...universal(),
});

export const institutions = pgTable(
  'institutions',
  {
    id: pkId(),
    name: text('name').notNull(),
    jurisdictionId: text('jurisdiction_id'),
    description: text('description'),
    confidenceState: text('confidence_state').notNull().default('official_source'),
    reviewState: text('review_state').notNull().default('approved'),
    visibility: text('visibility').notNull().default('public'),
    ...universal(),
  },
  () => [
    enumCheck('ck_institutions_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_institutions_review', 'review_state', REVIEW_STATES),
    enumCheck('ck_institutions_visibility', 'visibility', VISIBILITIES),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: pkId(),
    name: text('name').notNull(),
    institutionId: text('institution_id'),
    mandateId: text('mandate_id'),
    description: text('description'),
    authorizedByLaw: text('authorized_by_law'),
    decisionRights: jsonb('decision_rights'), // string[] of decision-right names
    confidenceState: text('confidence_state').notNull().default('official_source'),
    reviewState: text('review_state').notNull().default('approved'),
    visibility: text('visibility').notNull().default('public'),
    ...universal(),
  },
  () => [
    enumCheck('ck_roles_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_roles_review', 'review_state', REVIEW_STATES),
    enumCheck('ck_roles_visibility', 'visibility', VISIBILITIES),
  ],
);

export const decisionRights = pgTable('decision_rights', {
  id: pkId(),
  roleId: text('role_id'),
  name: text('name').notNull(),
  description: text('description'),
  ...universal(),
});

export const processes = pgTable(
  'processes',
  {
    id: pkId(),
    name: text('name').notNull(),
    need: text('need'),
    legalBasis: text('legal_basis'),
    jurisdictionId: text('jurisdiction_id'),
    confidenceState: text('confidence_state').notNull().default('official_source'),
    reviewState: text('review_state').notNull().default('approved'),
    visibility: text('visibility').notNull().default('public'),
    ...universal(),
  },
  () => [
    enumCheck('ck_processes_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_processes_review', 'review_state', REVIEW_STATES),
    enumCheck('ck_processes_visibility', 'visibility', VISIBILITIES),
  ],
);

export const processSteps = pgTable('process_steps', {
  id: pkId(),
  processId: text('process_id'),
  ordinal: numeric('ordinal'),
  name: text('name').notNull(),
  description: text('description'),
  ...universal(),
});

export const documentTypes = pgTable('document_types', {
  id: pkId(),
  name: text('name').notNull(),
  jurisdictionId: text('jurisdiction_id'),
  legalBasis: text('legal_basis'),
  description: text('description'),
  ...universal(),
});

export const failureModes = pgTable('failure_modes', {
  id: pkId(),
  name: text('name').notNull(),
  processId: text('process_id'),
  description: text('description'),
  ...universal(),
});

export const controls = pgTable('controls', {
  id: pkId(),
  name: text('name').notNull(),
  failureModeId: text('failure_mode_id'),
  description: text('description'),
  ...universal(),
});

export const budgetLines = pgTable('budget_lines', {
  id: pkId(),
  label: text('label').notNull(),
  amount: numeric('amount'),
  currency: text('currency'),
  fiscalYear: text('fiscal_year'),
  fundsInstitutionId: text('funds_institution_id'),
  fundsProgram: text('funds_program'),
  ...universal(),
});

export const publicServices = pgTable('public_services', {
  id: pkId(),
  name: text('name').notNull(),
  jurisdictionId: text('jurisdiction_id'),
  description: text('description'),
  ...universal(),
});

export const risks = pgTable('risks', {
  id: pkId(),
  name: text('name').notNull(),
  description: text('description'),
  severity: text('severity'),
  ...universal(),
});

/* ------------------------------------------------------------------ */
/* Graph (§11.5): generic adjacency                                   */
/* ------------------------------------------------------------------ */

export const relationships = pgTable(
  'relationships',
  {
    id: pkId(),
    relationshipType: text('relationship_type').notNull(),
    fromEntityType: text('from_entity_type').notNull(),
    fromEntityId: text('from_entity_id').notNull(),
    toEntityType: text('to_entity_type').notNull(),
    toEntityId: text('to_entity_id').notNull(),
    confidenceState: text('confidence_state').notNull().default('official_source'),
    reviewState: text('review_state').notNull().default('approved'),
    visibility: text('visibility').notNull().default('public'),
    sourceConfidence: numeric('source_confidence'),
    methodVersion: text('method_version'),
    ...universal(),
  },
  () => [
    enumCheck('ck_relationships_type', 'relationship_type', RELATIONSHIP_TYPES),
    enumCheck('ck_relationships_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_relationships_review', 'review_state', REVIEW_STATES),
    enumCheck('ck_relationships_visibility', 'visibility', VISIBILITIES),
  ],
);

/* ------------------------------------------------------------------ */
/* Evidence vault (§12)                                               */
/* ------------------------------------------------------------------ */

export const sources = pgTable('sources', {
  id: pkId(),
  title: text('title').notNull(),
  url: text('url'),
  jurisdictionId: text('jurisdiction_id'),
  sourceType: text('source_type'), // e.g. official, legal, news
  publisher: text('publisher'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...universal(),
});

export const sourceSnapshots = pgTable('source_snapshots', {
  id: pkId(),
  sourceId: text('source_id'),
  url: text('url'),
  contentHash: text('content_hash'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
  ...universal(),
});

export const documents = pgTable('documents', {
  id: pkId(),
  sourceId: text('source_id'),
  title: text('title'),
  documentClass: text('document_class'),
  url: text('url'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).defaultNow().notNull(),
  ...universal(),
});

export const claims = pgTable(
  'claims',
  {
    id: pkId(),
    text: text('text').notNull(),
    claimType: text('claim_type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    confidence: numeric('confidence').notNull(),
    confidenceState: text('confidence_state').notNull().default('unsupported_draft'),
    reviewState: text('review_state').notNull().default('draft'),
    visibility: text('visibility').notNull().default('public'),
    methodVersion: text('method_version'),
    aiTraceId: text('ai_trace_id'),
    ...universal(),
  },
  () => [
    enumCheck('ck_claims_type', 'claim_type', CLAIM_TYPES),
    enumCheck('ck_claims_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_claims_review', 'review_state', REVIEW_STATES),
    enumCheck('ck_claims_visibility', 'visibility', VISIBILITIES),
  ],
);

export const evidenceLinks = pgTable('evidence_links', {
  id: pkId(),
  claimId: text('claim_id').notNull(),
  sourceId: text('source_id').notNull(),
  locator: jsonb('locator'), // {page?, lineStart?, lineEnd?, xpath?, tableCell?, timestamp?}
  quote: text('quote'),
  paraphrase: text('paraphrase'),
  sourceHash: text('source_hash'),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }),
  confidence: numeric('confidence').notNull(),
  visibility: text('visibility').default('public').notNull(),
}, () => [
  enumCheck('ck_evidence_links_visibility', 'visibility', EVIDENCE_LINK_VISIBILITIES),
]);

export const reviewRecords = pgTable('review_records', {
  id: pkId(),
  claimId: text('claim_id').notNull(),
  reviewer: text('reviewer'),
  decision: text('decision'),
  note: text('note'),
  ...universal(),
});

export const confidenceScores = pgTable('confidence_scores', {
  id: pkId(),
  claimId: text('claim_id').notNull(),
  methodVersion: text('method_version'),
  score: numeric('score').notNull(),
  ...universal(),
});

/* ------------------------------------------------------------------ */
/* Audit (§26.3) — append-only hash chain                             */
/* ------------------------------------------------------------------ */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: pkId(),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    action: text('action').notNull(),
    reason: text('reason'),
    correlationId: text('correlation_id'),
    visibility: text('visibility').notNull().default('public'),
    data: jsonb('data'),
    redactedData: jsonb('redacted_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    hash: text('hash'),
    previousHash: text('previous_hash'),
  },
  (t) => [
    enumCheck('ck_audit_actor_type', 'actor_type', ACTOR_TYPES),
    enumCheck('ck_audit_visibility', 'visibility', VISIBILITIES),
    uniqueIndex('audit_events_created_idx').on(t.createdAt, t.id),
  ],
);

export const auditEventRedactions = pgTable('audit_event_redactions', {
  id: pkId(),
  auditEventId: text('audit_event_id').notNull(),
  field: text('field').notNull(),
  reason: text('reason'),
  redactedAt: timestamp('redacted_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Polis deliberation (§13) v0                                         */
/* ------------------------------------------------------------------ */

export const issues = pgTable(
  'issues',
  {
    id: pkId(),
    jurisdictionId: text('jurisdiction_id'),
    processId: text('process_id'), // supports GET /api/v1/processes/:id/issues
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    uniqueIndex('issues_slug_idx').on(t.slug),
    enumCheck('ck_issues_status', 'status', ISSUE_STATUSES),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: pkId(),
    issueId: text('issue_id').notNull(),
    externalPolisId: text('external_polis_id').notNull(),
    title: text('title').notNull(),
    framingQuestion: text('framing_question').notNull(),
    participationMode: text('participation_mode').notNull().default('open'),
    status: text('status').notNull().default('draft'),
    reportUrl: text('report_url'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
    auditCorrelationId: text('audit_correlation_id'),
  },
  () => [
    enumCheck('ck_conversations_participation', 'participation_mode', PARTICIPATION_MODES),
    enumCheck('ck_conversations_status', 'status', CONVERSATION_STATUSES),
  ],
);

export const conversationResults = pgTable('conversation_results', {
  // Append-only (new row per sync; no in-place update). No universal()/updatedAt —
  // follows evidence_links style (immutable explicit columns), not governance style.
  id: pkId(),
  conversationId: text('conversation_id').notNull(),
  consensusGroups: jsonb('consensus_groups'),
  participantCount: numeric('participant_count'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
});

export const proofManifests = pgTable(
  'proof_manifests',
  {
    // Append-only (new row per manifest; no in-place update). No universal()/
    // updatedAt — mirrors conversation_results: immutable explicit columns.
    id: pkId(),
    documentClass: text('document_class').notNull(),
    documentTypeId: text('document_type_id'),
    issuerId: text('issuer_id').notNull(),
    issuerName: text('issuer_name').notNull(),
    originalFileHash: text('original_file_hash').notNull(),
    canonicalPdfHash: text('canonical_pdf_hash'),
    ocrTextHash: text('ocr_text_hash'),
    metadataHash: text('metadata_hash'),
    manifestHash: text('manifest_hash').notNull(),
    originalFilename: text('original_filename'),
    originalMime: text('original_mime'),
    originalBytes: numeric('original_bytes'),
    algorithm: text('algorithm').notNull().default('sha256'),
    registryStatus: text('registry_status').notNull().default('active'),
    contentVisibility: text('content_visibility').notNull().default('public'),
    proofVisibility: text('proof_visibility').notNull().default('public'),
    manifestJson: jsonb('manifest_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdByService: text('created_by_service'),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    index('proof_manifests_original_hash_idx').on(t.originalFileHash),
    enumCheck('ck_proof_manifests_class', 'document_class', DOCUMENT_CLASSES),
    enumCheck('ck_proof_manifests_algorithm', 'algorithm', PROOF_ALGORITHMS),
    enumCheck('ck_proof_manifests_registry', 'registry_status', PROOF_REGISTRY_STATUSES),
    enumCheck('ck_proof_manifests_content_visibility', 'content_visibility', CONTENT_VISIBILITIES),
    enumCheck('ck_proof_manifests_proof_visibility', 'proof_visibility', PROOF_VISIBILITIES),
  ],
);
/* ------------------------------------------------------------------ */
/* Document proof extensions (§15.2 / §15.6 / §15.7) — M4               */
/* ------------------------------------------------------------------ */

// §15.7 signature registry. Issuer id is caller-supplied (e.g.
// 'issuer-demo-authority'); rows are upserted by signature-service so the
// demo issuer is self-seeding — no separate seed step.
export const proofIssuers = pgTable(
  'proof_issuers',
  {
    id: pkId(),
    name: text('name').notNull(),
    publicKeyRef: text('public_key_ref').notNull(),
    certificateRef: text('certificate_ref'),
    standard: text('standard').notNull().default('test-key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  () => [enumCheck('ck_proof_issuers_standard', 'standard', SIGNATURE_STANDARDS)],
);

// §15.7 signatures. Append-only. standard='test-key' is the test-key signal
// (no isTest column — the standard column is the discriminator).
export const proofSignatures = pgTable(
  'proof_signatures',
  {
    id: pkId(),
    proofId: text('proof_id').notNull(),
    issuerId: text('issuer_id'),
    type: text('type').notNull().default('institutional-seal'),
    standard: text('standard').notNull().default('test-key'),
    signerRef: text('signer_ref').notNull(),
    certificateRef: text('certificate_ref'),
    signatureValueRef: text('signature_value_ref').notNull(),
    signedHash: text('signed_hash').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    validationStatus: text('validation_status').notNull().default('valid'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('proof_signatures_proof_id_idx').on(t.proofId),
    enumCheck('ck_proof_signatures_type', 'type', SIGNATURE_TYPES),
    enumCheck('ck_proof_signatures_standard', 'standard', SIGNATURE_STANDARDS),
    enumCheck('ck_proof_signatures_validation', 'validation_status', VALIDATION_STATUSES),
  ],
);

// §15.6 RFC 3161 timestamps. Append-only; stores the token + validation result.
export const proofTimestamps = pgTable(
  'proof_timestamps',
  {
    id: pkId(),
    proofId: text('proof_id').notNull(),
    type: text('type').notNull().default('RFC3161'),
    timestampRef: text('timestamp_ref').notNull(),
    timestampedHash: text('timestamped_hash').notNull(),
    timestampedAt: timestamp('timestamped_at', { withTimezone: true }).notNull(),
    validationStatus: text('validation_status').notNull().default('valid'),
    tsa: text('tsa'),
    clockSource: text('clock_source'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('proof_timestamps_proof_id_idx').on(t.proofId),
    enumCheck('ck_proof_timestamps_type', 'type', TIMESTAMP_TYPES),
    enumCheck('ck_proof_timestamps_validation', 'validation_status', VALIDATION_STATUSES),
  ],
);

// §15.2 provenance.supersedes / registryStatus.supersededBy. Append-only;
// latest row per proof wins (clients ORDER BY created_at DESC LIMIT 1).
export const proofSupersessions = pgTable(
  'proof_supersessions',
  {
    id: pkId(),
    supersededProofId: text('superseded_proof_id').notNull(),
    supersedingProofId: text('superseding_proof_id').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('proof_supersessions_superseded_idx').on(t.supersededProofId),
    index('proof_supersessions_superseding_idx').on(t.supersedingProofId),
  ],
);

// §15.2 registryStatus='revoked'. Append-only; row existence == revoked.
export const proofRevocations = pgTable(
  'proof_revocations',
  {
    id: pkId(),
    proofId: text('proof_id').notNull(),
    reason: text('reason'),
    revokedBy: text('revoked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('proof_revocations_proof_id_idx').on(t.proofId)],
);
/* ------------------------------------------------------------------ */
/* AI assistant v0 (§17.5 AI trace + §17 AI output / review queue) — M5 */
/* ------------------------------------------------------------------ */

// §17.5 AI trace — internal-only, one row per assistant request.
// Append-only: no universal()/updatedAt; soft text FKs (no references()).
export const aiTraces = pgTable(
  'ai_traces',
  {
    id: pkId(),
    requestId: text('request_id').notNull(),
    workflowType: text('workflow_type').notNull().default('citizen-assistant'),
    userId: text('user_id'),
    promptHash: text('prompt_hash').notNull(),
    modelProvider: text('model_provider').notNull().default('polis'),
    modelName: text('model_name').notNull().default('stub'),
    modelVersion: text('model_version'),
    promptTemplateId: text('prompt_template_id').notNull().default('citizen-assistant-v1'),
    promptTemplateVersion: text('prompt_template_version').notNull().default('0.1'),
    retrievedSourceIds: jsonb('retrieved_source_ids'),
    retrievedClaimIds: jsonb('retrieved_claim_ids'),
    riskFlags: jsonb('risk_flags'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('ai_traces_request_id_idx').on(t.requestId)],
);

// §17 AI output — immutable at creation; effective review/publish state derived
// from the latest ai_review_queue row (mirrors proof_supersessions latest-row-wins).
export const aiOutputs = pgTable(
  'ai_outputs',
  {
    id: pkId(),
    traceId: text('trace_id').notNull(),
    answer: text('answer').notNull(),
    citations: jsonb('citations'),
    confidence: numeric('confidence'),
    confidenceState: text('confidence_state').notNull().default('unsupported_draft'),
    reviewState: text('review_state').notNull().default('draft'),
    published: boolean('published').notNull().default(false),
    outputHash: text('output_hash').notNull(),
    model: text('model').notNull().default('stub'),
    params: jsonb('params'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ai_outputs_trace_id_idx').on(t.traceId),
    enumCheck('ck_ai_outputs_confidence', 'confidence_state', CONFIDENCE_STATES),
    enumCheck('ck_ai_outputs_review', 'review_state', REVIEW_STATES),
  ],
);

// §17 human-review queue — append-only; latest row per output wins.
export const aiReviewQueue = pgTable(
  'ai_review_queue',
  {
    id: pkId(),
    outputId: text('output_id').notNull(),
    status: text('status').notNull().default('pending'),
    reviewerId: text('reviewer_id'),
    note: text('note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ai_review_queue_output_id_idx').on(t.outputId),
    enumCheck('ck_ai_review_queue_status', 'status', AI_REVIEW_STATUSES),
  ],
);
/* ------------------------------------------------------------------ */
/* Contribution & review (§19) v0 — M6                                  */
/* ------------------------------------------------------------------ */

// §21 identity levels stored as data (no real auth until M8).
export const contributors = pgTable(
  'contributors',
  {
    id: pkId(),
    identityLevel: text('identity_level').notNull().default('casual'),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  () => [enumCheck('ck_contributors_identity', 'identity_level', IDENTITY_LEVELS)],
);

// §19 submissions; payload is type-specific (see contribution-service).
// contributionClass is hoisted (not buried in payload) so the auto_publish
// policy check is a cheap read without parsing jsonb.
export const submissions = pgTable(
  'submissions',
  {
    id: pkId(),
    contributorId: text('contributor_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload'),
    status: text('status').notNull().default('pending'),
    contributionClass: text('contribution_class').notNull().default('civic'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('submissions_contributor_idx').on(t.contributorId),
    index('submissions_status_idx').on(t.status),
    enumCheck('ck_submissions_type', 'type', SUBMISSION_TYPES),
    enumCheck('ck_submissions_status', 'status', SUBMISSION_STATUSES),
  ],
);

// §11 graph-edit staging; applied on approval (appliedAt set), never edited.
export const graphProposals = pgTable(
  'graph_proposals',
  {
    id: pkId(),
    submissionId: text('submission_id').notNull(),
    targetTable: text('target_table').notNull(),
    targetId: text('target_id'),
    op: text('op').notNull(),
    proposedPayload: jsonb('proposed_payload'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('graph_proposals_submission_idx').on(t.submissionId),
    enumCheck('ck_graph_proposals_op', 'op', GRAPH_PROPOSAL_OPS),
  ],
);

// §19 review decisions; latest row per submission wins (append-only).
export const reviews = pgTable(
  'reviews',
  {
    id: pkId(),
    submissionId: text('submission_id').notNull(),
    reviewerId: text('reviewer_id'),
    decision: text('decision').notNull(),
    notes: text('notes'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('reviews_submission_idx').on(t.submissionId),
    enumCheck('ck_reviews_decision', 'decision', REVIEW_DECISIONS),
  ],
);

// §20.4 reward eligibility event — one row per evaluated approved contribution.
// Idempotent on submission_id (unique). 'denied' rows (cap hit) are kept for the
// §20.5 appeal path; only 'eligible' rows feed the public aggregate ledger.
export const rewardEligibilityEvents = pgTable(
  'reward_eligibility_events',
  {
    id: pkId(),
    submissionId: text('submission_id').notNull(),
    contributorId: text('contributor_id').notNull(),
    contributionClass: text('contribution_class').notNull(),
    period: text('period').notNull(), // 'YYYY-MM' (UTC) — cap + ledger grouping
    amount: numeric('amount').notNull(), // drizzle numeric → string at rest
    outcome: text('outcome').notNull(),
    denialReason: text('denial_reason'), // null when eligible; 'monthly_cap_reached' when denied
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('reward_elig_submission_idx').on(t.submissionId),
    index('reward_elig_contributor_period_idx').on(t.contributorId, t.period),
    enumCheck('ck_reward_elig_outcome', 'outcome', REWARD_ELIGIBILITY_OUTCOMES),
  ],
);

// §20.4 private payout row — created 1:1 with each eligible event, pending until
// exported. NEVER exposed via a public route (acceptance: payout details private).
export const rewardPayouts = pgTable(
  'reward_payouts',
  {
    id: pkId(),
    eligibilityId: text('eligibility_id').notNull(),
    contributorId: text('contributor_id').notNull(),
    amount: numeric('amount').notNull(),
    period: text('period').notNull(),
    status: text('status').notNull().default('pending'),
    payoutRef: text('payout_ref'), // set at export, e.g. 'payout-<ms>'
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('reward_payouts_contributor_idx').on(t.contributorId),
    index('reward_payouts_status_idx').on(t.status),
    enumCheck('ck_reward_payouts_status', 'status', PAYOUT_STATUSES),
  ],
);

// §21 persistent citizen identity (M8 Option A). Email is the login handle;
// passcodeHash is a bcrypt-style hash; magic-link tokens are single-use and
// hashed at rest. identityLevel mirrors the §21.1 'verified_resident' tier
// required for vault access.
export const citizens = pgTable(
  'citizens',
  {
    id: pkId(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    identityLevel: text('identity_level').notNull().default('verified_resident'),
    passcodeHash: text('passcode_hash'), // null until passcode set
    magicTokenHash: text('magic_token_hash'), // single-use; null when consumed
    magicTokenExpiresAt: timestamp('magic_token_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('citizens_email_idx').on(t.email),
    enumCheck('ck_citizens_identity', 'identity_level', IDENTITY_AUTH_LEVELS),
  ],
);

// M10 external-identity link — binds an IdP subject (Keycloak `sub`) to a
// citizen. UNIQUE(provider, subject) is the load-bearing invariant: one IdP
// subject → one citizen. citizenId is a soft text FK (no references(); mirrors
// vaultDocuments.citizenId). provider e.g. 'keycloak'.
export const externalIdentities = pgTable(
  'external_identities',
  {
    id: pkId(),
    citizenId: text('citizen_id').notNull(),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('external_identities_provider_subject_idx').on(t.provider, t.subject),
    index('external_identities_citizen_idx').on(t.citizenId),
  ],
);

// §16.2 citizen's listing of their own official documents/proofs.
export const vaultDocuments = pgTable(
  'vault_documents',
  {
    id: pkId(),
    citizenId: text('citizen_id').notNull(),
    documentId: text('document_id'), // soft FK documents.id
    proofManifestId: text('proof_manifest_id'), // soft FK proof_manifests.id
    label: text('label').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('vault_documents_citizen_idx').on(t.citizenId)],
);

// §16.3 access grant. grantee {type,id,name?} stored as jsonb (mirrors AccessGrant).
export const accessGrants = pgTable(
  'access_grants',
  {
    id: pkId(),
    granterId: text('granter_id').notNull(), // citizens.id of the owner
    grantee: jsonb('grantee').notNull(), // { type, id, name? }
    purpose: text('purpose').notNull(), // §16.4 purpose-limitation mandatory
    scope: text('scope').notNull(),
    vaultDocumentId: text('vault_document_id'), // null = all owner docs (scoped at verify)
    startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    policyRef: text('policy_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('access_grants_granter_idx').on(t.granterId),
    index('access_grants_grantee_idx').on(t.grantee),
    enumCheck('ck_access_grants_scope', 'scope', ACCESS_GRANT_SCOPES),
    enumCheck('ck_access_grants_status', 'status', ACCESS_GRANT_STATUSES),
  ],
);

// §16.4 access audit — visible to the citizen (who/what/when/why).
export const accessEvents = pgTable(
  'access_events',
  {
    id: pkId(),
    grantId: text('grant_id').notNull(),
    event: text('event').notNull(),
    actorId: text('actor_id').notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('access_events_grant_idx').on(t.grantId),
    enumCheck('ck_access_events_event', 'event', ACCESS_EVENT_TYPES),
  ],
);

// §15 proof-only sharing VC. vc jsonb is a test-key-signed presentation (v1);
// NEVER carries document content — only proof manifest refs + a verdict.
export const verifiableCredentials = pgTable(
  'verifiable_credentials',
  {
    id: pkId(),
    grantId: text('grant_id').notNull(),
    vc: jsonb('vc').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
  },
  (t) => [
    index('verifiable_credentials_grant_idx').on(t.grantId),
    enumCheck('ck_vc_status', 'status', VC_STATUSES),
  ],
);
/* ------------------------------------------------------------------ */
/* Provider-neutral charter signing                                    */
/* ------------------------------------------------------------------ */

// Immutable artifact metadata. Content is stored separately so public proof
// queries cannot accidentally select restricted signed charter bytes.
export const documentArtifacts = pgTable(
  'document_artifacts',
  {
    id: pkId(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    derivedFromArtifactId: text('derived_from_artifact_id'),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    byteCount: integer('byte_count').notNull(),
    filename: text('filename'),
    visibility: text('visibility').notNull(),
    storageMode: text('storage_mode').notNull(),
    storageRef: text('storage_ref').notNull(),
    provenance: jsonb('provenance'),
    createdByService: text('created_by_service').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    uniqueIndex('document_artifacts_subject_kind_version_idx').on(
      t.subjectType,
      t.subjectId,
      t.kind,
      t.version,
    ),
    index('document_artifacts_sha256_idx').on(t.sha256),
    index('document_artifacts_derived_from_idx').on(t.derivedFromArtifactId),
    enumCheck('ck_document_artifacts_kind', 'kind', DOCUMENT_ARTIFACT_KINDS),
    enumCheck('ck_document_artifacts_visibility', 'visibility', VISIBILITIES),
    enumCheck('ck_document_artifacts_storage_mode', 'storage_mode', DOCUMENT_ARTIFACT_STORAGE_MODES),
    check('ck_document_artifacts_version', sql`version > 0`),
    check('ck_document_artifacts_byte_count', sql`byte_count >= 0`),
  ],
);

export const documentArtifactBlobs = pgTable('document_artifact_blobs', {
  artifactId: text('artifact_id').primaryKey(),
  content: bytea('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const signingRequests = pgTable(
  'signing_requests',
  {
    id: pkId(),
    provider: text('provider').notNull(),
    charterId: text('charter_id').notNull(),
    mandateHolderId: text('mandate_holder_id').notNull(),
    unsignedArtifactId: text('unsigned_artifact_id').notNull(),
    signedArtifactId: text('signed_artifact_id'),
    proofManifestId: text('proof_manifest_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    providerEnvelopeId: text('provider_envelope_id'),
    status: text('status').notNull().default('created'),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    reconcileAttempts: integer('reconcile_attempts').notNull().default(0),
    providerCompletedAt: timestamp('provider_completed_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    failureDetailRedacted: text('failure_detail_redacted'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    uniqueIndex('signing_requests_idempotency_idx').on(t.idempotencyKey),
    uniqueIndex('signing_requests_provider_envelope_idx').on(t.provider, t.providerEnvelopeId),
    index('signing_requests_charter_idx').on(t.charterId),
    index('signing_requests_holder_idx').on(t.mandateHolderId),
    index('signing_requests_status_idx').on(t.status),
    enumCheck('ck_signing_requests_provider', 'provider', SIGNING_PROVIDERS),
    enumCheck('ck_signing_requests_status', 'status', SIGNING_REQUEST_STATUSES),
    check('ck_signing_requests_reconcile_attempts', sql`reconcile_attempts >= 0`),
  ],
);

export const signingRecipients = pgTable(
  'signing_recipients',
  {
    id: pkId(),
    signingRequestId: text('signing_request_id').notNull(),
    citizenId: text('citizen_id').notNull(),
    role: text('role').notNull(),
    signingOrder: integer('signing_order').notNull(),
    providerRecipientId: text('provider_recipient_id'),
    status: text('status').notNull().default('pending'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('signing_recipients_request_citizen_role_idx').on(
      t.signingRequestId,
      t.citizenId,
      t.role,
    ),
    uniqueIndex('signing_recipients_request_provider_recipient_idx').on(
      t.signingRequestId,
      t.providerRecipientId,
    ),
    index('signing_recipients_request_idx').on(t.signingRequestId),
    enumCheck('ck_signing_recipients_role', 'role', SIGNING_RECIPIENT_ROLES),
    enumCheck('ck_signing_recipients_status', 'status', SIGNING_RECIPIENT_STATUSES),
    check('ck_signing_recipients_order', sql`signing_order > 0`),
  ],
);

export const signingProviderEvents = pgTable(
  'signing_provider_events',
  {
    id: pkId(),
    provider: text('provider').notNull(),
    signingRequestId: text('signing_request_id'),
    eventName: text('event_name').notNull(),
    eventFingerprint: text('event_fingerprint').notNull(),
    payloadHash: text('payload_hash').notNull(),
    redactedData: jsonb('redacted_data'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('signing_provider_events_dedupe_idx').on(t.provider, t.eventFingerprint),
    index('signing_provider_events_request_idx').on(t.signingRequestId),
    enumCheck('ck_signing_provider_events_provider', 'provider', SIGNING_PROVIDERS),
  ],
);

export const mandateHolderCharterEvents = pgTable(
  'mandate_holder_charter_events',
  {
    id: pkId(),
    charterId: text('charter_id').notNull(),
    signingRequestId: text('signing_request_id'),
    event: text('event').notNull(),
    actorId: text('actor_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    index('mandate_holder_charter_events_charter_idx').on(t.charterId, t.occurredAt),
    index('mandate_holder_charter_events_request_idx').on(t.signingRequestId),
    enumCheck(
      'ck_mandate_holder_charter_events_event',
      'event',
      MANDATE_HOLDER_CHARTER_EVENTS,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Representative accountability (M-RA) v0                              */
/* ------------------------------------------------------------------ */

// M-RA mandate-holder: binds a specific verified_official citizen to a role
// + jurisdiction for a period. Distinct from `mandates` (legal-basis concept).
// Inlines explicit audit columns + a constrained lifecycle `status` (does NOT
// spread universal() — its generic `status` has no default/notNull).
export const mandateHolders = pgTable(
  'mandate_holders',
  {
    id: pkId(),
    citizenId: text('citizen_id').notNull(),
    roleId: text('role_id'),
    jurisdictionId: text('jurisdiction_id'),
    displayName: text('display_name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: text('created_by_user_id'),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    enumCheck('ck_mandate_holders_status', 'status', MANDATE_HOLDER_STATUSES),
    index('mandate_holders_citizen_idx').on(t.citizenId),
    index('mandate_holders_jurisdiction_idx').on(t.jurisdictionId),
  ],
);

// M-RA charter lifecycle. A charter remains pending until a completed signing
// request is accepted; signed content stays in restricted document artifacts.
export const mandateHolderCharters = pgTable(
  'mandate_holder_charters',
  {
    id: pkId(),
    mandateHolderId: text('mandate_holder_id').notNull(),
    charterDoc: jsonb('charter_doc'),
    version: integer('version').notNull().default(1),
    acceptedSigningRequestId: text('accepted_signing_request_id'),
    signedArtifactId: text('signed_artifact_id'),
    proofManifestId: text('proof_manifest_id'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    supersedesCharterId: text('supersedes_charter_id'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    enumCheck('ck_mandate_holder_charters_status', 'status', CHARTER_STATUSES),
    check('ck_mandate_holder_charters_version', sql`version > 0`),
    uniqueIndex('mandate_holder_charters_holder_version_idx').on(t.mandateHolderId, t.version),
    uniqueIndex('mandate_holder_charters_signing_request_idx').on(t.acceptedSigningRequestId),
    uniqueIndex('mandate_holder_charters_signed_artifact_idx').on(t.signedArtifactId),
    uniqueIndex('mandate_holder_charters_proof_manifest_idx').on(t.proofManifestId),
    index('mandate_holder_charters_supersedes_idx').on(t.supersedesCharterId),
  ],
);

// M-RA commitment: a pledge bound to a promise claim. Effective status is
// derived from commitment_status_events (latest-row-wins), never stored here,
// so it spreads universal() like claims (generic status unused for lifecycle).
export const commitments = pgTable(
  'commitments',
  {
    id: pkId(),
    claimId: text('claim_id').notNull(),
    mandateHolderId: text('mandate_holder_id').notNull(),
    processId: text('process_id'),
    jurisdictionId: text('jurisdiction_id'),
    successCriterion: text('success_criterion').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    ...universal(),
  },
  (t) => [
    index('commitments_holder_idx').on(t.mandateHolderId),
    index('commitments_due_idx').on(t.dueAt),
  ],
);

// M-RA status event: append-only timeline (latest row wins). Mirrors reviews
// (no universal()); `overdue` is derived in the read layer, never seeded here.
export const commitmentStatusEvents = pgTable(
  'commitment_status_events',
  {
    id: pkId(),
    commitmentId: text('commitment_id').notNull(),
    status: text('status').notNull(),
    resolutionClaimId: text('resolution_claim_id'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [
    enumCheck('ck_commitment_status_events_status', 'status', COMMITMENT_STATUSES),
    index('commitment_status_events_commitment_idx').on(t.commitmentId),
  ],
);

// M-RA citizen question on a commitment: a prompt (not a claim), authored by
// any authenticated citizen and auto-published (no review). Mirrors commitments
// (universal(); generic status unused — questions are publish-once).
export const commitmentQuestions = pgTable(
  'commitment_questions',
  {
    id: pkId(),
    commitmentId: text('commitment_id').notNull(),
    askedByCitizenId: text('asked_by_citizen_id').notNull(),
    body: text('body').notNull(),
    ...universal(),
  },
  (t) => [index('commitment_questions_commitment_idx').on(t.commitmentId)],
);

// M-RA official answer to a question: mandate-holder authored, admin-adjudicated
// (a 'mandate_answer' submission applied on approval). Append-only; latest row
// per question wins (mirrors commitment_status_events — no universal()).
export const commitmentAnswers = pgTable(
  'commitment_answers',
  {
    id: pkId(),
    questionId: text('question_id').notNull(),
    mandateHolderId: text('mandate_holder_id').notNull(),
    body: text('body').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    auditCorrelationId: text('audit_correlation_id'),
  },
  (t) => [index('commitment_answers_question_idx').on(t.questionId)],
);

export const schema = {
  appMeta,

  jurisdictions,
  mandates,
  laws,
  institutions,
  roles,
  decisionRights,
  processes,
  processSteps,
  documentTypes,
  failureModes,
  controls,
  budgetLines,
  publicServices,
  risks,
  relationships,
  sources,
  sourceSnapshots,
  documents,
  claims,
  evidenceLinks,
  reviewRecords,
  confidenceScores,
  auditEvents,
  auditEventRedactions,
  issues,
  conversations,
  conversationResults,
  proofManifests,
  documentArtifacts,
  documentArtifactBlobs,
  signingRequests,
  signingRecipients,
  signingProviderEvents,
  proofIssuers,
  proofSignatures,
  proofTimestamps,
  proofSupersessions,
  proofRevocations,
  aiTraces,
  aiOutputs,
  aiReviewQueue,
  contributors,
  submissions,
  graphProposals,
  reviews,
  rewardEligibilityEvents,
  rewardPayouts,
  citizens,
  externalIdentities,
  vaultDocuments,
  accessGrants,
  accessEvents,
  mandateHolders,
  mandateHolderCharters,
  mandateHolderCharterEvents,
  commitments,
  commitmentStatusEvents,
  commitmentQuestions,
  commitmentAnswers,
  verifiableCredentials,
};

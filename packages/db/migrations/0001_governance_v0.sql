CREATE TABLE "audit_event_redactions" (
	"id" text PRIMARY KEY NOT NULL,
	"audit_event_id" text NOT NULL,
	"field" text NOT NULL,
	"reason" text,
	"redacted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"action" text NOT NULL,
	"reason" text,
	"correlation_id" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"data" jsonb,
	"redacted_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hash" text,
	"previous_hash" text,
	CONSTRAINT "ck_audit_actor_type" CHECK (actor_type in ('user','service','system','partner')),
	CONSTRAINT "ck_audit_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"amount" numeric,
	"currency" text,
	"fiscal_year" text,
	"funds_institution_id" text,
	"funds_program" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"claim_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"confidence" numeric NOT NULL,
	"confidence_state" text DEFAULT 'unsupported_draft' NOT NULL,
	"review_state" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"method_version" text,
	"ai_trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_claims_type" CHECK (claim_type in ('legal_mandate','budget_amount','role_responsibility','process_step','document_requirement','risk_assessment','proposal_assertion','public_statement','other')),
	CONSTRAINT "ck_claims_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_claims_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived')),
	CONSTRAINT "ck_claims_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "confidence_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"method_version" text,
	"score" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "controls" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"failure_mode_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "decision_rights" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"jurisdiction_id" text,
	"legal_basis" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"title" text,
	"document_class" text,
	"url" text,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "evidence_links" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"source_id" text NOT NULL,
	"locator" jsonb,
	"quote" text,
	"paraphrase" text,
	"source_hash" text,
	"retrieved_at" timestamp with time zone,
	"confidence" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_modes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"process_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"jurisdiction_id" text,
	"description" text,
	"confidence_state" text DEFAULT 'official_source' NOT NULL,
	"review_state" text DEFAULT 'approved' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_institutions_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_institutions_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived')),
	CONSTRAINT "ck_institutions_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"jurisdiction_path" text NOT NULL,
	"description" text,
	"confidence_state" text DEFAULT 'official_source' NOT NULL,
	"review_state" text DEFAULT 'approved' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_jurisdictions_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_jurisdictions_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived')),
	CONSTRAINT "ck_jurisdictions_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "laws" (
	"id" text PRIMARY KEY NOT NULL,
	"citation" text NOT NULL,
	"title" text,
	"jurisdiction_id" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"legal_basis" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "process_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text,
	"ordinal" numeric,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"need" text,
	"legal_basis" text,
	"jurisdiction_id" text,
	"confidence_state" text DEFAULT 'official_source' NOT NULL,
	"review_state" text DEFAULT 'approved' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_processes_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_processes_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived')),
	CONSTRAINT "ck_processes_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "public_services" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"jurisdiction_id" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"relationship_type" text NOT NULL,
	"from_entity_type" text NOT NULL,
	"from_entity_id" text NOT NULL,
	"to_entity_type" text NOT NULL,
	"to_entity_id" text NOT NULL,
	"confidence_state" text DEFAULT 'official_source' NOT NULL,
	"review_state" text DEFAULT 'approved' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"source_confidence" numeric,
	"method_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_relationships_type" CHECK (relationship_type in ('JURISDICTION_HAS_INSTITUTION','INSTITUTION_HAS_ROLE','ROLE_AUTHORIZED_BY_LAW','ROLE_HAS_MANDATE','ROLE_CONTROLS_DECISION_RIGHT','ROLE_PARTICIPATES_IN_PROCESS','PROCESS_HAS_STEP','STEP_REQUIRES_DOCUMENT_TYPE','INSTITUTION_ISSUES_DOCUMENT_TYPE','LAW_AUTHORIZES_DOCUMENT_TYPE','BUDGET_FUNDS_INSTITUTION','BUDGET_FUNDS_PROGRAM','PROCESS_CREATES_FAILURE_MODE','FAILURE_MODE_MITIGATED_BY_CONTROL','PROPOSAL_CHANGES_PROCESS','PROPOSAL_REDUCES_FAILURE_MODE','PROPOSAL_INTRODUCES_RISK','CLAIM_SUPPORTED_BY_SOURCE','DOCUMENT_PROOF_LINKS_TO_DOCUMENT_TYPE','POLIS_CONVERSATION_DELIBERATES_ISSUE','CONSENSUS_CLUSTER_SUPPORTS_PROPOSAL')),
	CONSTRAINT "ck_relationships_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_relationships_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived')),
	CONSTRAINT "ck_relationships_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "review_records" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"reviewer" text,
	"decision" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"severity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"institution_id" text,
	"mandate_id" text,
	"description" text,
	"authorized_by_law" text,
	"decision_rights" jsonb,
	"confidence_state" text DEFAULT 'official_source' NOT NULL,
	"review_state" text DEFAULT 'approved' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_roles_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_roles_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived')),
	CONSTRAINT "ck_roles_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal'))
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"url" text,
	"content_hash" text,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"jurisdiction_id" text,
	"source_type" text,
	"publisher" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdictions_slug_idx" ON "jurisdictions" USING btree ("slug");
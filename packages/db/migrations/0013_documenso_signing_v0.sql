CREATE TABLE "document_artifact_blobs" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"content" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"derived_from_artifact_id" text,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_count" integer NOT NULL,
	"filename" text,
	"visibility" text NOT NULL,
	"storage_mode" text NOT NULL,
	"storage_ref" text NOT NULL,
	"provenance" jsonb,
	"created_by_service" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_document_artifacts_kind" CHECK (kind in ('charter_unsigned','charter_signed','provider_receipt')),
	CONSTRAINT "ck_document_artifacts_visibility" CHECK (visibility in ('public','private','restricted','redacted','sealed','internal')),
	CONSTRAINT "ck_document_artifacts_storage_mode" CHECK (storage_mode in ('database','s3')),
	CONSTRAINT "ck_document_artifacts_version" CHECK (version > 0),
	CONSTRAINT "ck_document_artifacts_byte_count" CHECK (byte_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "mandate_holder_charter_events" (
	"id" text PRIMARY KEY NOT NULL,
	"charter_id" text NOT NULL,
	"signing_request_id" text,
	"event" text NOT NULL,
	"actor_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_mandate_holder_charter_events_event" CHECK (event in ('initiated','distributed','completed','accepted','declined','expired','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "signing_provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"signing_request_id" text,
	"event_name" text NOT NULL,
	"event_fingerprint" text NOT NULL,
	"payload_hash" text NOT NULL,
	"redacted_data" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "ck_signing_provider_events_provider" CHECK (provider in ('stub','documenso'))
);
--> statement-breakpoint
CREATE TABLE "signing_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"signing_request_id" text NOT NULL,
	"citizen_id" text NOT NULL,
	"role" text NOT NULL,
	"signing_order" integer NOT NULL,
	"provider_recipient_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_signing_recipients_role" CHECK (role in ('signer','approver','witness')),
	CONSTRAINT "ck_signing_recipients_status" CHECK (status in ('pending','sent','opened','signed','declined')),
	CONSTRAINT "ck_signing_recipients_order" CHECK (signing_order > 0)
);
--> statement-breakpoint
CREATE TABLE "signing_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"charter_id" text NOT NULL,
	"mandate_holder_id" text NOT NULL,
	"unsigned_artifact_id" text NOT NULL,
	"signed_artifact_id" text,
	"proof_manifest_id" text,
	"idempotency_key" text NOT NULL,
	"provider_envelope_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"provider_completed_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail_redacted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_signing_requests_provider" CHECK (provider in ('stub','documenso')),
	CONSTRAINT "ck_signing_requests_status" CHECK (status in ('created','distributed','awaiting_signatures','completed','declined','expired','voided','failed')),
	CONSTRAINT "ck_signing_requests_reconcile_attempts" CHECK (reconcile_attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "citizens" DROP CONSTRAINT "ck_citizens_identity";--> statement-breakpoint
DROP INDEX "mandate_holder_charters_holder_idx";--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD COLUMN "accepted_signing_request_id" text;--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD COLUMN "signed_artifact_id" text;--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD COLUMN "proof_manifest_id" text;--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD COLUMN "supersedes_charter_id" text;--> statement-breakpoint
UPDATE "mandate_holder_charters"
SET
	"status" = 'pending',
	"accepted_signing_request_id" = NULL,
	"signed_artifact_id" = NULL,
	"proof_manifest_id" = NULL,
	"signed_at" = NULL
WHERE "status" = 'accepted';--> statement-breakpoint
CREATE UNIQUE INDEX "document_artifacts_subject_kind_version_idx" ON "document_artifacts" USING btree ("subject_type","subject_id","kind","version");--> statement-breakpoint
CREATE INDEX "document_artifacts_sha256_idx" ON "document_artifacts" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "document_artifacts_derived_from_idx" ON "document_artifacts" USING btree ("derived_from_artifact_id");--> statement-breakpoint
CREATE INDEX "mandate_holder_charter_events_charter_idx" ON "mandate_holder_charter_events" USING btree ("charter_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mandate_holder_charter_events_request_idx" ON "mandate_holder_charter_events" USING btree ("signing_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_provider_events_dedupe_idx" ON "signing_provider_events" USING btree ("provider","event_fingerprint");--> statement-breakpoint
CREATE INDEX "signing_provider_events_request_idx" ON "signing_provider_events" USING btree ("signing_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_recipients_request_citizen_role_idx" ON "signing_recipients" USING btree ("signing_request_id","citizen_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_recipients_request_provider_recipient_idx" ON "signing_recipients" USING btree ("signing_request_id","provider_recipient_id");--> statement-breakpoint
CREATE INDEX "signing_recipients_request_idx" ON "signing_recipients" USING btree ("signing_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_idempotency_idx" ON "signing_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_provider_envelope_idx" ON "signing_requests" USING btree ("provider","provider_envelope_id");--> statement-breakpoint
CREATE INDEX "signing_requests_charter_idx" ON "signing_requests" USING btree ("charter_id");--> statement-breakpoint
CREATE INDEX "signing_requests_holder_idx" ON "signing_requests" USING btree ("mandate_holder_id");--> statement-breakpoint
CREATE INDEX "signing_requests_status_idx" ON "signing_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_holder_charters_holder_version_idx" ON "mandate_holder_charters" USING btree ("mandate_holder_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_holder_charters_signing_request_idx" ON "mandate_holder_charters" USING btree ("accepted_signing_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_holder_charters_signed_artifact_idx" ON "mandate_holder_charters" USING btree ("signed_artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_holder_charters_proof_manifest_idx" ON "mandate_holder_charters" USING btree ("proof_manifest_id");--> statement-breakpoint
CREATE INDEX "mandate_holder_charters_supersedes_idx" ON "mandate_holder_charters" USING btree ("supersedes_charter_id");--> statement-breakpoint
ALTER TABLE "citizens" ADD CONSTRAINT "ck_citizens_identity" CHECK (identity_level in ('verified_resident','verified_official','staff'));--> statement-breakpoint
ALTER TABLE "mandate_holder_charters" ADD CONSTRAINT "ck_mandate_holder_charters_version" CHECK (version > 0);
CREATE TABLE "access_events" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"event" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_access_events_event" CHECK (event in ('grant','access','revoke'))
);
--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"granter_id" text NOT NULL,
	"grantee" jsonb NOT NULL,
	"purpose" text NOT NULL,
	"scope" text NOT NULL,
	"vault_document_id" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"policy_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_access_grants_scope" CHECK (scope in ('proof_only','metadata','redacted_content','full_content','vc_presentation')),
	CONSTRAINT "ck_access_grants_status" CHECK (status in ('active','expired','revoked','pending'))
);
--> statement-breakpoint
CREATE TABLE "citizens" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"identity_level" text DEFAULT 'verified_resident' NOT NULL,
	"passcode_hash" text,
	"magic_token_hash" text,
	"magic_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_citizens_identity" CHECK (identity_level in ('verified_resident','verified_official'))
);
--> statement-breakpoint
CREATE TABLE "vault_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"citizen_id" text NOT NULL,
	"document_id" text,
	"proof_manifest_id" text,
	"label" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifiable_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"vc" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "ck_vc_status" CHECK (status in ('active','expired','revoked'))
);
--> statement-breakpoint
CREATE INDEX "access_events_grant_idx" ON "access_events" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "access_grants_granter_idx" ON "access_grants" USING btree ("granter_id");--> statement-breakpoint
CREATE INDEX "access_grants_grantee_idx" ON "access_grants" USING btree ("grantee");--> statement-breakpoint
CREATE UNIQUE INDEX "citizens_email_idx" ON "citizens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "vault_documents_citizen_idx" ON "vault_documents" USING btree ("citizen_id");--> statement-breakpoint
CREATE INDEX "verifiable_credentials_grant_idx" ON "verifiable_credentials" USING btree ("grant_id");
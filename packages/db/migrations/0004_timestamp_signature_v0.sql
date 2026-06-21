CREATE TABLE "proof_issuers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"public_key_ref" text NOT NULL,
	"certificate_ref" text,
	"standard" text DEFAULT 'test-key' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_proof_issuers_standard" CHECK (standard in ('eIDAS-QES','eIDAS-AdES','eIDAS-eSeal','test-key','other'))
);
--> statement-breakpoint
CREATE TABLE "proof_revocations" (
	"id" text PRIMARY KEY NOT NULL,
	"proof_id" text NOT NULL,
	"reason" text,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"proof_id" text NOT NULL,
	"issuer_id" text,
	"type" text DEFAULT 'institutional-seal' NOT NULL,
	"standard" text DEFAULT 'test-key' NOT NULL,
	"signer_ref" text NOT NULL,
	"certificate_ref" text,
	"signature_value_ref" text NOT NULL,
	"signed_hash" text NOT NULL,
	"signed_at" timestamp with time zone,
	"validation_status" text DEFAULT 'valid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_proof_signatures_type" CHECK (type in ('citizen-signature','official-signature','institutional-seal')),
	CONSTRAINT "ck_proof_signatures_standard" CHECK (standard in ('eIDAS-QES','eIDAS-AdES','eIDAS-eSeal','test-key','other')),
	CONSTRAINT "ck_proof_signatures_validation" CHECK (validation_status in ('valid','invalid','indeterminate','not_checked'))
);
--> statement-breakpoint
CREATE TABLE "proof_supersessions" (
	"id" text PRIMARY KEY NOT NULL,
	"superseded_proof_id" text NOT NULL,
	"superseding_proof_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_timestamps" (
	"id" text PRIMARY KEY NOT NULL,
	"proof_id" text NOT NULL,
	"type" text DEFAULT 'RFC3161' NOT NULL,
	"timestamp_ref" text NOT NULL,
	"timestamped_hash" text NOT NULL,
	"timestamped_at" timestamp with time zone NOT NULL,
	"validation_status" text DEFAULT 'valid' NOT NULL,
	"tsa" text,
	"clock_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_proof_timestamps_type" CHECK (type in ('RFC3161','eIDAS-qualified-timestamp','blockchain-anchor','internal-test')),
	CONSTRAINT "ck_proof_timestamps_validation" CHECK (validation_status in ('valid','invalid','indeterminate','not_checked'))
);
--> statement-breakpoint
CREATE INDEX "proof_revocations_proof_id_idx" ON "proof_revocations" USING btree ("proof_id");--> statement-breakpoint
CREATE INDEX "proof_signatures_proof_id_idx" ON "proof_signatures" USING btree ("proof_id");--> statement-breakpoint
CREATE INDEX "proof_supersessions_superseded_idx" ON "proof_supersessions" USING btree ("superseded_proof_id");--> statement-breakpoint
CREATE INDEX "proof_supersessions_superseding_idx" ON "proof_supersessions" USING btree ("superseding_proof_id");--> statement-breakpoint
CREATE INDEX "proof_timestamps_proof_id_idx" ON "proof_timestamps" USING btree ("proof_id");
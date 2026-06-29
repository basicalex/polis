CREATE TABLE "commitment_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"commitment_id" text NOT NULL,
	"status" text NOT NULL,
	"resolution_claim_id" text,
	"decided_by" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_commitment_status_events_status" CHECK (status in ('proposed','in_progress','delivered','partial','not_delivered','overdue'))
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"mandate_holder_id" text NOT NULL,
	"process_id" text,
	"jurisdiction_id" text,
	"success_criterion" text NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "mandate_holder_charters" (
	"id" text PRIMARY KEY NOT NULL,
	"mandate_holder_id" text NOT NULL,
	"charter_doc" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_mandate_holder_charters_status" CHECK (status in ('pending','accepted','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "mandate_holders" (
	"id" text PRIMARY KEY NOT NULL,
	"citizen_id" text NOT NULL,
	"role_id" text,
	"jurisdiction_id" text,
	"display_name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_mandate_holders_status" CHECK (status in ('active','ended','revoked'))
);
--> statement-breakpoint
CREATE INDEX "commitment_status_events_commitment_idx" ON "commitment_status_events" USING btree ("commitment_id");--> statement-breakpoint
CREATE INDEX "commitments_holder_idx" ON "commitments" USING btree ("mandate_holder_id");--> statement-breakpoint
CREATE INDEX "commitments_due_idx" ON "commitments" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "mandate_holder_charters_holder_idx" ON "mandate_holder_charters" USING btree ("mandate_holder_id");--> statement-breakpoint
CREATE INDEX "mandate_holders_citizen_idx" ON "mandate_holders" USING btree ("citizen_id");--> statement-breakpoint
CREATE INDEX "mandate_holders_jurisdiction_idx" ON "mandate_holders" USING btree ("jurisdiction_id");
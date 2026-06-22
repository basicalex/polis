CREATE TABLE "contributors" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_level" text DEFAULT 'casual' NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_contributors_identity" CHECK (identity_level in ('anonymous','casual','verified','enrolled','staff'))
);
--> statement-breakpoint
CREATE TABLE "graph_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"target_table" text NOT NULL,
	"target_id" text,
	"op" text NOT NULL,
	"proposed_payload" jsonb,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_graph_proposals_op" CHECK (op in ('insert','update','delete'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"reviewer_id" text,
	"decision" text NOT NULL,
	"notes" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reviews_decision" CHECK (decision in ('approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"contributor_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"contribution_class" text DEFAULT 'civic' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ck_submissions_type" CHECK (type in ('evidence','graph_edit','claim')),
	CONSTRAINT "ck_submissions_status" CHECK (status in ('pending','in_review','approved','rejected'))
);
--> statement-breakpoint
CREATE INDEX "graph_proposals_submission_idx" ON "graph_proposals" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "reviews_submission_idx" ON "reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_contributor_idx" ON "submissions" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status");
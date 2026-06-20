CREATE TABLE "conversation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"consensus_groups" jsonb,
	"participant_count" numeric,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"external_polis_id" text NOT NULL,
	"title" text NOT NULL,
	"framing_question" text NOT NULL,
	"participation_mode" text DEFAULT 'open' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"report_url" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_conversations_participation" CHECK (participation_mode in ('open','pseudonymous','verified','partner_restricted')),
	CONSTRAINT "ck_conversations_status" CHECK (status in ('draft','active','closed','reported','archived'))
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"jurisdiction_id" text,
	"process_id" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"audit_correlation_id" text,
	CONSTRAINT "ck_issues_status" CHECK (status in ('open','deliberating','resolved','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "issues_slug_idx" ON "issues" USING btree ("slug");
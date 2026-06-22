CREATE TABLE "ai_outputs" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb,
	"confidence" numeric,
	"confidence_state" text DEFAULT 'unsupported_draft' NOT NULL,
	"review_state" text DEFAULT 'draft' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"output_hash" text NOT NULL,
	"model" text DEFAULT 'stub' NOT NULL,
	"params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_outputs_confidence" CHECK (confidence_state in ('unsupported_draft','single_source','multi_source','official_source','official_confirmed','expert_reviewed','contested','outdated','superseded')),
	CONSTRAINT "ck_ai_outputs_review" CHECK (review_state in ('draft','submitted','needs_revision','under_review','approved','contested','deprecated','rejected','archived'))
);
--> statement-breakpoint
CREATE TABLE "ai_review_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"output_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_review_queue_status" CHECK (status in ('pending','approved','rejected'))
);
--> statement-breakpoint
CREATE TABLE "ai_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"workflow_type" text DEFAULT 'citizen-assistant' NOT NULL,
	"user_id" text,
	"prompt_hash" text NOT NULL,
	"model_provider" text DEFAULT 'polis' NOT NULL,
	"model_name" text DEFAULT 'stub' NOT NULL,
	"model_version" text,
	"prompt_template_id" text DEFAULT 'citizen-assistant-v1' NOT NULL,
	"prompt_template_version" text DEFAULT '0.1' NOT NULL,
	"retrieved_source_ids" jsonb,
	"retrieved_claim_ids" jsonb,
	"risk_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_outputs_trace_id_idx" ON "ai_outputs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "ai_review_queue_output_id_idx" ON "ai_review_queue" USING btree ("output_id");--> statement-breakpoint
CREATE INDEX "ai_traces_request_id_idx" ON "ai_traces" USING btree ("request_id");
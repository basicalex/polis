CREATE TABLE "commitment_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"mandate_holder_id" text NOT NULL,
	"body" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "commitment_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"commitment_id" text NOT NULL,
	"asked_by_citizen_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"status" text,
	"audit_correlation_id" text
);
--> statement-breakpoint
CREATE INDEX "commitment_answers_question_idx" ON "commitment_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "commitment_questions_commitment_idx" ON "commitment_questions" USING btree ("commitment_id");
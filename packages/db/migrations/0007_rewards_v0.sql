CREATE TABLE "reward_eligibility_events" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"contributor_id" text NOT NULL,
	"contribution_class" text NOT NULL,
	"period" text NOT NULL,
	"amount" numeric NOT NULL,
	"outcome" text NOT NULL,
	"denial_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reward_elig_outcome" CHECK (outcome in ('eligible','denied'))
);
--> statement-breakpoint
CREATE TABLE "reward_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"eligibility_id" text NOT NULL,
	"contributor_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout_ref" text,
	"exported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reward_payouts_status" CHECK (status in ('pending','paid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_elig_submission_idx" ON "reward_eligibility_events" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "reward_elig_contributor_period_idx" ON "reward_eligibility_events" USING btree ("contributor_id","period");--> statement-breakpoint
CREATE INDEX "reward_payouts_contributor_idx" ON "reward_payouts" USING btree ("contributor_id");--> statement-breakpoint
CREATE INDEX "reward_payouts_status_idx" ON "reward_payouts" USING btree ("status");
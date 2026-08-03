CREATE TABLE "complaint_appeals" (
	"id" text PRIMARY KEY NOT NULL,
	"complaint_id" text NOT NULL,
	"resident_citizen_id" text NOT NULL,
	"initial_decision_id" text NOT NULL,
	"grounds" text NOT NULL,
	"status" text DEFAULT 'filed' NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "ck_complaint_appeals_status" CHECK (status in ('filed','decided')),
	CONSTRAINT "ck_complaint_appeals_grounds_nonempty" CHECK (btrim(grounds) <> '')
);
--> statement-breakpoint
CREATE TABLE "complaint_case_events" (
	"id" text PRIMARY KEY NOT NULL,
	"complaint_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_complaint_case_events_event_type" CHECK (event_type in ('submitted','assigned','information_requested','information_received','decided','appealed','appeal_decided','closed')),
	CONSTRAINT "ck_complaint_case_events_actor_type" CHECK (actor_type in ('user','service','system','partner')),
	CONSTRAINT "ck_complaint_case_events_from_status" CHECK (from_status in ('submitted','assigned','awaiting_information','decided','appealed','closed')),
	CONSTRAINT "ck_complaint_case_events_to_status" CHECK (to_status in ('submitted','assigned','awaiting_information','decided','appealed','closed')),
	CONSTRAINT "ck_complaint_case_events_transition" CHECK ((from_status is null and to_status = 'submitted')
        or (from_status = 'submitted' and to_status = 'assigned')
        or (from_status = 'assigned' and to_status = 'awaiting_information')
        or (from_status = 'awaiting_information' and to_status = 'assigned')
        or (from_status = 'assigned' and to_status = 'decided')
        or (from_status = 'decided' and to_status = 'appealed')
        or (from_status = 'decided' and to_status = 'closed')
        or (from_status = 'appealed' and to_status = 'closed'))
);
--> statement-breakpoint
CREATE TABLE "complaint_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"case_number" text NOT NULL,
	"resident_citizen_id" text NOT NULL,
	"institution_id" text NOT NULL,
	"process_id" text NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"subject" text NOT NULL,
	"narrative" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"assigned_mandate_holder_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"audit_correlation_id" text,
	CONSTRAINT "ck_complaint_cases_status" CHECK (status in ('submitted','assigned','awaiting_information','decided','appealed','closed')),
	CONSTRAINT "ck_complaint_cases_case_number_nonempty" CHECK (btrim(case_number) <> ''),
	CONSTRAINT "ck_complaint_cases_subject_nonempty" CHECK (btrim(subject) <> ''),
	CONSTRAINT "ck_complaint_cases_narrative_nonempty" CHECK (btrim(narrative) <> '')
);
--> statement-breakpoint
CREATE TABLE "complaint_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"complaint_id" text NOT NULL,
	"appeal_id" text,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_correlation_id" text,
	CONSTRAINT "ck_complaint_decisions_kind" CHECK (kind in ('initial','appeal')),
	CONSTRAINT "ck_complaint_decisions_outcome_nonempty" CHECK (btrim(outcome) <> ''),
	CONSTRAINT "ck_complaint_decisions_reason_nonempty" CHECK (btrim(reason) <> '')
);
--> statement-breakpoint
CREATE TABLE "complaint_information_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"complaint_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"question" text NOT NULL,
	"due_at" timestamp with time zone,
	"responded_by" text,
	"response" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_complaint_information_requests_question_nonempty" CHECK (btrim(question) <> ''),
	CONSTRAINT "ck_complaint_information_requests_response_nonempty" CHECK (response is null or btrim(response) <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "complaint_appeals_complaint_idx" ON "complaint_appeals" USING btree ("complaint_id");--> statement-breakpoint
CREATE INDEX "complaint_case_events_complaint_occurred_id_idx" ON "complaint_case_events" USING btree ("complaint_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "complaint_cases_case_number_idx" ON "complaint_cases" USING btree ("case_number");--> statement-breakpoint
CREATE INDEX "complaint_cases_resident_created_idx" ON "complaint_cases" USING btree ("resident_citizen_id","created_at");--> statement-breakpoint
CREATE INDEX "complaint_cases_status_created_idx" ON "complaint_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "complaint_cases_assigned_holder_idx" ON "complaint_cases" USING btree ("assigned_mandate_holder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "complaint_decisions_complaint_kind_idx" ON "complaint_decisions" USING btree ("complaint_id","kind");--> statement-breakpoint
CREATE INDEX "complaint_decisions_complaint_decided_idx" ON "complaint_decisions" USING btree ("complaint_id","decided_at");--> statement-breakpoint
CREATE INDEX "complaint_information_requests_complaint_created_idx" ON "complaint_information_requests" USING btree ("complaint_id","created_at");
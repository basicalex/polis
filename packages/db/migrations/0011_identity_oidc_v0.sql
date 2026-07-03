CREATE TABLE "external_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"citizen_id" text NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_provider_subject_idx" ON "external_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "external_identities_citizen_idx" ON "external_identities" USING btree ("citizen_id");
ALTER TABLE "evidence_links" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_links" ADD CONSTRAINT "ck_evidence_links_visibility" CHECK (visibility in ('public','restricted','private'));

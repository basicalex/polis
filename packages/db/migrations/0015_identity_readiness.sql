CREATE TABLE "identity_oidc_login_states" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_identity_oidc_login_states_state_hash" CHECK (state_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_identity_oidc_login_states_verifier" CHECK (btrim(code_verifier) <> ''),
	CONSTRAINT "ck_identity_oidc_login_states_nonce" CHECK (btrim(nonce) <> ''),
	CONSTRAINT "ck_identity_oidc_login_states_redirect" CHECK (btrim(redirect_uri) <> ''),
	CONSTRAINT "ck_identity_oidc_login_states_expiry" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE TABLE "identity_session_revocations" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"citizen_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_identity_session_revocations_token_hash" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_identity_session_revocations_expiry" CHECK (expires_at > revoked_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "identity_oidc_login_states_state_hash_idx" ON "identity_oidc_login_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "identity_oidc_login_states_expires_idx" ON "identity_oidc_login_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_session_revocations_token_hash_idx" ON "identity_session_revocations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "identity_session_revocations_expires_idx" ON "identity_session_revocations" USING btree ("expires_at");
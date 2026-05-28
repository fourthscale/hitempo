CREATE TABLE "user_gmail_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"gmail_address" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_gmail_credentials" ADD CONSTRAINT "user_gmail_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gmail_creds_org" ON "user_gmail_credentials" USING btree ("organization_id");
--> statement-breakpoint

-- RLS: a user can only see/manage their own Gmail credentials row.
-- Service role (bypassing RLS) is used by the OAuth callback to insert the
-- ciphertext, and by the Inngest reply-polling job to read all rows.
ALTER TABLE "user_gmail_credentials" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_gmail_credentials_select_own"
  ON "user_gmail_credentials"
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "user_gmail_credentials_delete_own"
  ON "user_gmail_credentials"
  FOR DELETE
  USING (user_id = auth.uid());

-- No INSERT/UPDATE policies for end users: token writes go through the
-- service role from the OAuth callback / refresh helper.
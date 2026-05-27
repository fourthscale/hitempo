CREATE TYPE "public"."llm_usage_status" AS ENUM('success', 'error');--> statement-breakpoint
CREATE TYPE "public"."llm_usage_type" AS ENUM('outbound_message', 'brand_brief_generation', 'interaction_summary', 'company_enrichment', 'signal_extraction', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('email', 'linkedin');--> statement-breakpoint
CREATE TYPE "public"."message_intent" AS ENUM('first_contact', 'follow_up', 'meeting_request', 'proposal_send', 'reconnect', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('draft', 'copied', 'discarded', 'sent');--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "llm_usage_type" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"status" "llm_usage_status" DEFAULT 'success' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"user_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"intent" "message_intent" NOT NULL,
	"locale" text NOT NULL,
	"orientation" text,
	"content" text NOT NULL,
	"llm_usage_id" uuid NOT NULL,
	"status" "message_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- NOTE: interactions.task_id was applied manually via psql in sprint 05
-- (see supabase/migrations/20260527120000_interactions_task_id.sql).
-- Drizzle re-emits the ADD COLUMN here because no migration tool tracked the earlier change.
-- The line is intentionally removed; the column and its index already exist in the DB.
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_llm_usage_id_llm_usage_id_fk" FOREIGN KEY ("llm_usage_id") REFERENCES "public"."llm_usage"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_llm_usage_org" ON "llm_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_type" ON "llm_usage" USING btree ("organization_id","type","created_at");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_user" ON "llm_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_contact" ON "messages" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_company" ON "messages" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_org" ON "messages" USING btree ("organization_id","created_at");
-- idx_interactions_task already created in the sprint-05 manual migration; do not recreate.
-- ============================================================================
-- RLS policies — sprint 07 (llm_usage + messages)
-- Same 4-statement pattern as previous business tables :
--   SELECT  : org members OR platform admin
--   INS/UPD : org members only
--   DELETE  : org members only
-- ============================================================================

-- RLS: llm_usage
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "llm_usage_select" ON llm_usage FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "llm_usage_insert" ON llm_usage FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "llm_usage_update" ON llm_usage FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "llm_usage_delete" ON llm_usage FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- RLS: messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON messages FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "messages_insert" ON messages FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "messages_update" ON messages FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "messages_delete" ON messages FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));

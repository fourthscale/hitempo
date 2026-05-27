CREATE TYPE "public"."interaction_channel" AS ENUM('email', 'linkedin', 'phone', 'in_person', 'video', 'other');--> statement-breakpoint
CREATE TYPE "public"."interaction_outcome" AS ENUM('no_response', 'positive_reply', 'negative_reply', 'out_of_office', 'wrong_contact', 'rdv_scheduled', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('first_contact', 'follow_up', 'call', 'visit', 'linkedin', 'meeting', 'demo', 'proposal_sent', 'note');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('email', 'linkedin', 'phone', 'visit', 'follow_up', 'research', 'other');--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"site_id" uuid,
	"type" "interaction_type" NOT NULL,
	"channel" "interaction_channel" NOT NULL,
	"outcome" "interaction_outcome",
	"subject" text,
	"summary" text,
	"interest_level" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"user_id" uuid,
	"sequence_run_id" uuid,
	"message_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"site_id" uuid,
	"type" "task_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"due_at" timestamp with time zone,
	"scheduled_for" timestamp with time zone,
	"assignee_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"sequence_run_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_interactions_company" ON "interactions" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_interactions_contact" ON "interactions" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_interactions_org" ON "interactions" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_assignee_due" ON "tasks" USING btree ("assignee_id","due_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_org_status" ON "tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_company" ON "tasks" USING btree ("company_id");

-- RLS: interactions
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interactions_select" ON interactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "interactions_insert" ON interactions FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "interactions_update" ON interactions FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "interactions_delete" ON interactions FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- RLS: tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));
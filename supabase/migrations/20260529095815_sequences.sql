CREATE TYPE "public"."sequence_end_reason" AS ENUM('exhausted', 'success', 'cascaded', 'opted_out', 'manual', 'safety_loop_cap_reached');--> statement-breakpoint
CREATE TYPE "public"."sequence_status" AS ENUM('active', 'paused', 'completed_exhausted', 'completed_success', 'completed_cascaded', 'stopped_opted_out', 'stopped_manual');--> statement-breakpoint
CREATE TYPE "public"."sequence_step_action_type" AS ENUM('create_task_manual', 'create_task_with_ai_draft', 'wait_delay', 'enroll_in_sequence', 'end_success');--> statement-breakpoint
CREATE TYPE "public"."sequence_step_delay_unit" AS ENUM('minutes', 'hours', 'days');--> statement-breakpoint
CREATE TABLE "sequence_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"assignee_id" uuid,
	"status" "sequence_status" DEFAULT 'active' NOT NULL,
	"current_step_id" uuid NOT NULL,
	"current_step_order" integer NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_execution_counter" integer DEFAULT 0 NOT NULL,
	"max_execution_count" integer DEFAULT 200 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "sequence_end_reason"
);
--> statement-breakpoint
CREATE TABLE "sequence_step_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrolment_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"action_type" "sequence_step_action_type" NOT NULL,
	"execution_counter" integer NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"task_id" uuid,
	"outcome" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"action_type" "sequence_step_action_type" NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_step_ids" jsonb,
	"condition" jsonb,
	"filter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"target_relationship_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"target_site_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"target_contact_roles" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"target_locales" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"exclude_if_company_has_active_sequence" boolean DEFAULT true NOT NULL,
	"exclude_if_company_relationship_in" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"cooldown_after_completed_days" integer,
	"draft_definition" jsonb,
	"draft_saved_at" timestamp with time zone,
	"editing_locked_by" uuid,
	"editing_locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "sequence_enrolments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "sequence_enrolments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "sequence_enrolments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "sequence_enrolments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "sequence_enrolments_current_step_id_sequence_steps_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step_executions" ADD CONSTRAINT "sequence_step_executions_enrolment_id_sequence_enrolments_id_fk" FOREIGN KEY ("enrolment_id") REFERENCES "public"."sequence_enrolments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step_executions" ADD CONSTRAINT "sequence_step_executions_step_id_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_seq_enrolments_due" ON "sequence_enrolments" USING btree ("organization_id","status","next_due_at");--> statement-breakpoint
CREATE INDEX "idx_seq_enrolments_contact" ON "sequence_enrolments" USING btree ("contact_id","status");--> statement-breakpoint
CREATE INDEX "idx_seq_enrolments_company" ON "sequence_enrolments" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_seq_enrolments_active_per_contact" ON "sequence_enrolments" USING btree ("sequence_id","contact_id") WHERE status IN ('active', 'paused');--> statement-breakpoint
CREATE INDEX "idx_seq_executions_enrolment" ON "sequence_step_executions" USING btree ("enrolment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_seq_executions_counter" ON "sequence_step_executions" USING btree ("enrolment_id","execution_counter");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sequence_steps_order" ON "sequence_steps" USING btree ("sequence_id","step_order");--> statement-breakpoint
CREATE INDEX "idx_sequences_org_active" ON "sequences" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_tasks_sequence_enrolment" ON "tasks" USING btree ("sequence_run_id");--> statement-breakpoint

-- ============================================================================
-- Enrolment end-state consistency (sprint 11) : active/paused ⇒ no end info ;
-- any terminal status ⇒ ended_at + end_reason both set. Defense-in-depth ;
-- the engine + actions are the primary guards.
-- ============================================================================
ALTER TABLE "sequence_enrolments" ADD CONSTRAINT "chk_seq_enrolment_end_consistency" CHECK (
  ("status" IN ('active', 'paused') AND "ended_at" IS NULL AND "end_reason" IS NULL)
  OR
  ("status" NOT IN ('active', 'paused') AND "ended_at" IS NOT NULL AND "end_reason" IS NOT NULL)
);--> statement-breakpoint

-- ============================================================================
-- RLS — same 4-statement pattern as messages / message_attachments :
--   SELECT  : org members OR platform admin
--   INS/UPD : org members only
--   DELETE  : org members only
-- Applied to all four sequence tables. The two child tables (steps,
-- executions) are scoped through their parent's organization_id via a
-- subquery since they don't carry organization_id directly.
-- ============================================================================

-- sequences
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sequences_select" ON sequences FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());--> statement-breakpoint
CREATE POLICY "sequences_insert" ON sequences FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "sequences_update" ON sequences FOR UPDATE
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "sequences_delete" ON sequences FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));--> statement-breakpoint

-- sequence_enrolments
ALTER TABLE sequence_enrolments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sequence_enrolments_select" ON sequence_enrolments FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());--> statement-breakpoint
CREATE POLICY "sequence_enrolments_insert" ON sequence_enrolments FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "sequence_enrolments_update" ON sequence_enrolments FOR UPDATE
  USING (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));--> statement-breakpoint
CREATE POLICY "sequence_enrolments_delete" ON sequence_enrolments FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));--> statement-breakpoint

-- sequence_steps (scoped via parent sequence's org)
ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sequence_steps_select" ON sequence_steps FOR SELECT
  USING (
    sequence_id IN (SELECT id FROM sequences WHERE organization_id IN (SELECT public.user_organization_ids()))
    OR public.is_platform_admin()
  );--> statement-breakpoint
CREATE POLICY "sequence_steps_insert" ON sequence_steps FOR INSERT
  WITH CHECK (sequence_id IN (SELECT id FROM sequences WHERE organization_id IN (SELECT public.user_organization_ids())));--> statement-breakpoint
CREATE POLICY "sequence_steps_update" ON sequence_steps FOR UPDATE
  USING (sequence_id IN (SELECT id FROM sequences WHERE organization_id IN (SELECT public.user_organization_ids())))
  WITH CHECK (sequence_id IN (SELECT id FROM sequences WHERE organization_id IN (SELECT public.user_organization_ids())));--> statement-breakpoint
CREATE POLICY "sequence_steps_delete" ON sequence_steps FOR DELETE
  USING (sequence_id IN (SELECT id FROM sequences WHERE organization_id IN (SELECT public.user_organization_ids())));--> statement-breakpoint

-- sequence_step_executions (scoped via parent enrolment's org)
ALTER TABLE sequence_step_executions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sequence_step_executions_select" ON sequence_step_executions FOR SELECT
  USING (
    enrolment_id IN (SELECT id FROM sequence_enrolments WHERE organization_id IN (SELECT public.user_organization_ids()))
    OR public.is_platform_admin()
  );--> statement-breakpoint
CREATE POLICY "sequence_step_executions_insert" ON sequence_step_executions FOR INSERT
  WITH CHECK (enrolment_id IN (SELECT id FROM sequence_enrolments WHERE organization_id IN (SELECT public.user_organization_ids())));--> statement-breakpoint
CREATE POLICY "sequence_step_executions_update" ON sequence_step_executions FOR UPDATE
  USING (enrolment_id IN (SELECT id FROM sequence_enrolments WHERE organization_id IN (SELECT public.user_organization_ids())))
  WITH CHECK (enrolment_id IN (SELECT id FROM sequence_enrolments WHERE organization_id IN (SELECT public.user_organization_ids())));--> statement-breakpoint
CREATE POLICY "sequence_step_executions_delete" ON sequence_step_executions FOR DELETE
  USING (enrolment_id IN (SELECT id FROM sequence_enrolments WHERE organization_id IN (SELECT public.user_organization_ids())));
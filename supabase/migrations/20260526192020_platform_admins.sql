CREATE TABLE "platform_admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid,
	"operation" text NOT NULL,
	"organization_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "idx_platform_audit_user" ON "platform_admin_audit" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_org" ON "platform_admin_audit" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_platform_audit_table" ON "platform_admin_audit" USING btree ("table_name","occurred_at");--> statement-breakpoint

-- ============================================================================
-- Sprint 03 — Multi-tenancy & RLS bootstrap
-- See docs/architecture.md → "Platform admin pattern"
-- See docs/conventions/rls.md for the canonical per-table pattern
-- ============================================================================

-- FK to auth.users (cross-schema, Drizzle doesn't track)
ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;--> statement-breakpoint

-- Helper: returns true if the current auth.uid() is in platform_admins.
-- STABLE SECURITY DEFINER so policies can call it without recursing into RLS.
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
$$;--> statement-breakpoint

-- ============================================================================
-- Updated policies on existing tables: organizations + organization_members
-- Pattern: read = org member OR platform admin; write = org member only.
-- ============================================================================

DROP POLICY IF EXISTS "users_read_own_orgs" ON "organizations";--> statement-breakpoint
DROP POLICY IF EXISTS "users_read_own_memberships" ON "organization_members";--> statement-breakpoint

CREATE POLICY "read_organizations" ON "organizations" FOR SELECT USING (
  id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);--> statement-breakpoint

CREATE POLICY "write_organizations" ON "organizations" FOR ALL USING (
  id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  id IN (SELECT public.user_organization_ids())
);--> statement-breakpoint

CREATE POLICY "read_organization_members" ON "organization_members" FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);--> statement-breakpoint

CREATE POLICY "write_organization_members" ON "organization_members" FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);--> statement-breakpoint

-- ============================================================================
-- platform_admins itself: only admins manage admins.
-- ============================================================================

ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "admins_manage_admins" ON "platform_admins" FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());--> statement-breakpoint

-- ============================================================================
-- platform_admin_audit: only admins read; writes only via trigger (table owner).
-- ============================================================================

ALTER TABLE "platform_admin_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "admins_read_audit" ON "platform_admin_audit" FOR SELECT
  USING (public.is_platform_admin());--> statement-breakpoint

-- ============================================================================
-- Audit trigger function — logs cross-org INSERT/UPDATE/DELETE by platform admins.
-- Attach to every business table (see docs/conventions/rls.md).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_platform_admin_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org_id uuid;
  v_row_id uuid;
  v_payload jsonb;
BEGIN
  -- Only log when the actor is a platform admin.
  IF NOT public.is_platform_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_payload := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_row_id := (v_payload ->> 'id')::uuid;

  -- For business tables: organization_id is a column on the row.
  -- For the `organizations` table itself: the row IS the org, so use its id.
  IF TG_TABLE_NAME = 'organizations' THEN
    v_org_id := v_row_id;
  ELSE
    v_org_id := (v_payload ->> 'organization_id')::uuid;
  END IF;

  -- Skip log if the org is one of the admin's own memberships
  -- (i.e. not cross-org access — they're acting as a regular member).
  IF v_org_id IS NOT NULL AND v_org_id IN (SELECT public.user_organization_ids()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO platform_admin_audit (user_id, table_name, row_id, operation, organization_id)
  VALUES (v_user, TG_TABLE_NAME, v_row_id, TG_OP, v_org_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER "trg_organizations_admin_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();--> statement-breakpoint

CREATE TRIGGER "trg_organization_members_admin_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "organization_members"
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();
CREATE TYPE "public"."company_relationship_type" AS ENUM('prospect', 'client', 'former_client', 'prescriber', 'partner');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('decision_maker', 'influencer', 'user', 'prescriber', 'assistant', 'other');--> statement-breakpoint
CREATE TYPE "public"."site_type" AS ENUM('office', 'hotel', 'showroom', 'store', 'restaurant', 'warehouse', 'other');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"website_url" text,
	"linkedin_url" text,
	"logo_url" text,
	"parent_id" uuid,
	"relationship_type" "company_relationship_type",
	"segment_id" uuid,
	"sub_segment" text,
	"primary_locale" text DEFAULT 'fr' NOT NULL,
	"size_estimate" text,
	"standing" integer,
	"industry" text,
	"score" integer,
	"score_breakdown" jsonb,
	"status" text DEFAULT 'to_qualify' NOT NULL,
	"signal_type" text,
	"signal_source" text,
	"signal_detected_at" timestamp with time zone,
	"notes" text,
	"owner_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"job_title" text,
	"role" "contact_role",
	"email" text,
	"email_validated" boolean DEFAULT false,
	"phone" text,
	"linkedin_url" text,
	"preferred_language" text DEFAULT 'fr' NOT NULL,
	"preferred_channel" text,
	"relevance" integer,
	"status" text DEFAULT 'to_contact' NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"opted_out_reason" text,
	"last_contacted_at" timestamp with time zone,
	"last_response_at" timestamp with time zone,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "site_type" DEFAULT 'office' NOT NULL,
	"address_line_1" text,
	"address_line_2" text,
	"postal_code" text,
	"city" text,
	"region" text,
	"country" text DEFAULT 'FR' NOT NULL,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"micro_zone_id" uuid,
	"is_primary" boolean DEFAULT false NOT NULL,
	"standing" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_companies_org" ON "companies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_companies_org_score" ON "companies" USING btree ("organization_id","score");--> statement-breakpoint
CREATE INDEX "idx_companies_org_status" ON "companies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_companies_parent" ON "companies" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_companies_segment" ON "companies" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_site" ON "contacts" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_org" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_email" ON "contacts" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_sites_company" ON "sites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sites_micro_zone" ON "sites" USING btree ("micro_zone_id");--> statement-breakpoint
CREATE INDEX "idx_sites_org" ON "sites" USING btree ("organization_id");--> statement-breakpoint

-- ============================================================================
-- Self-referencing FK on companies (parent → companies.id)
-- Drizzle doesn't emit self-refs out of the box; added by hand.
-- ============================================================================

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_parent_id_companies_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "companies"("id") ON DELETE SET NULL;--> statement-breakpoint

-- ============================================================================
-- Generated STORED column for contacts.full_name (concat first + last)
-- ============================================================================

ALTER TABLE "contacts"
  ADD COLUMN "full_name" text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;--> statement-breakpoint

-- ============================================================================
-- RLS recipe (per docs/conventions/rls.md) — applied verbatim per table
-- ============================================================================

-- companies
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "read_companies" ON "companies" FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);--> statement-breakpoint
CREATE POLICY "write_companies" ON "companies" FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);--> statement-breakpoint
CREATE TRIGGER "trg_companies_admin_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "companies"
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();--> statement-breakpoint

-- sites
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "read_sites" ON "sites" FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);--> statement-breakpoint
CREATE POLICY "write_sites" ON "sites" FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);--> statement-breakpoint
CREATE TRIGGER "trg_sites_admin_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "sites"
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();--> statement-breakpoint

-- contacts
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "read_contacts" ON "contacts" FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);--> statement-breakpoint
CREATE POLICY "write_contacts" ON "contacts" FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);--> statement-breakpoint
CREATE TRIGGER "trg_contacts_admin_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "contacts"
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();
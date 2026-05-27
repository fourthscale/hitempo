CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'commercial', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."organization_plan" AS ENUM('trial', 'starter', 'pro', 'business');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'commercial' NOT NULL,
	"preferred_locale" text DEFAULT 'fr' NOT NULL,
	"timezone" text DEFAULT 'Europe/Paris' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" "organization_plan" DEFAULT 'trial' NOT NULL,
	"default_locale" text DEFAULT 'fr' NOT NULL,
	"supported_locales" text[] DEFAULT ARRAY['fr', 'en'] NOT NULL,
	"brand_brief" jsonb DEFAULT '{}'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_org_user" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_user" ON "organization_members" USING btree ("user_id");--> statement-breakpoint

-- Enable RLS (business policies added in sprint 03)
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Helper function for RLS (used by future policies on all business tables)
CREATE OR REPLACE FUNCTION public.user_organization_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
$$;--> statement-breakpoint

-- Allow authenticated users to read their own memberships
CREATE POLICY "users_read_own_memberships" ON "organization_members" FOR SELECT
  USING (user_id = auth.uid());--> statement-breakpoint

-- Allow authenticated users to read orgs they belong to
CREATE POLICY "users_read_own_orgs" ON "organizations" FOR SELECT
  USING (id IN (SELECT public.user_organization_ids()));
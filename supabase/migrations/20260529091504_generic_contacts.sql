CREATE TYPE "public"."contact_kind" AS ENUM('person', 'generic');--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "first_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "last_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "kind" "contact_kind" DEFAULT 'person' NOT NULL;--> statement-breakpoint

-- ============================================================================
-- Consistency CHECK (sprint 10.8) : a person needs first+last name ; a generic
-- contact needs at least one channel (email or phone). Application-layer Zod
-- is the primary guard ; this is defense in depth against direct writes.
-- Existing rows all default to 'person' and already had NOT NULL names, so
-- none violate the constraint.
-- ============================================================================
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_kind_consistency" CHECK (
  ("kind" = 'person'  AND "first_name" IS NOT NULL AND "last_name" IS NOT NULL)
  OR
  ("kind" = 'generic' AND ("email" IS NOT NULL OR "phone" IS NOT NULL))
);
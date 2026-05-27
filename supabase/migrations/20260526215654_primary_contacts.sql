ALTER TABLE "companies" ADD COLUMN "primary_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "primary_contact_id" uuid;--> statement-breakpoint

-- ============================================================================
-- Sprint 4.6 — Primary contacts (one per company, one per site)
-- ============================================================================

-- FK cross-circular with contacts (both nullable, ON DELETE SET NULL — fine)
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_primary_contact_id_fkey"
  FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "sites"
  ADD CONSTRAINT "sites_primary_contact_id_fkey"
  FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Enforce: at most one primary site per company (DB-level invariant)
CREATE UNIQUE INDEX "uniq_sites_primary_per_company"
  ON "sites" ("company_id") WHERE "is_primary" = true;--> statement-breakpoint

-- Backfill: existing primary contacts (top relevance per company/site) become the new explicit primaries.
-- This preserves the current UI behavior for already-seeded data without forcing a reseed.
UPDATE "companies" c
SET primary_contact_id = (
  SELECT id FROM contacts
  WHERE company_id = c.id AND deleted_at IS NULL
  ORDER BY relevance DESC NULLS LAST, last_name ASC
  LIMIT 1
)
WHERE primary_contact_id IS NULL;--> statement-breakpoint

UPDATE "sites" s
SET primary_contact_id = (
  SELECT id FROM contacts
  WHERE site_id = s.id AND deleted_at IS NULL
  ORDER BY relevance DESC NULLS LAST, last_name ASC
  LIMIT 1
)
WHERE primary_contact_id IS NULL;
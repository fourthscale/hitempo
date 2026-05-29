-- Sprint 11 (sequences) — optional per-contact owner override.
--
-- Account ownership lives on companies.owner_id ; this adds an optional
-- contact-level override (null = inherit the company owner). Soft reference
-- (no FK to auth.users). Additive + idempotent.

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "owner_id" uuid;

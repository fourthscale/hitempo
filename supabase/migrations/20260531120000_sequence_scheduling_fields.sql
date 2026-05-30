-- Sprint 11.5 slice 2 — scheduling-aware fields for sequence-driven tasks.
-- All additive. Defaults populate existing rows safely.

-- 1) Timezone cascade : org (root) + companies / sites / contacts (optional).
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris';

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT;

ALTER TABLE "sites"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT;

ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT;

-- 2) Member's work pattern + per-day quotas for sequence-driven tasks.
--    work_pattern is JSONB (nullable → DEFAULT_WORK_PATTERN applied in code).
ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "work_pattern" JSONB;

ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "max_emails_per_day" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "max_calls_per_day" INTEGER NOT NULL DEFAULT 10;

-- 3) Task-level fields.
--    due_at_all_day : UI hint to hide the hour part.
--    estimated_duration_minutes : effective slot duration (defaulted from step).
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "due_at_all_day" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "estimated_duration_minutes" INTEGER;

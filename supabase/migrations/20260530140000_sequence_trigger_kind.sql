-- Explicit trigger kind on sequences. Phase A only ships "manual" (contacts
-- enrolled by hand from a contact's page). Extension points later : "signal",
-- "score_threshold", "rule", etc. Additive-only.

DO $$ BEGIN
  CREATE TYPE "sequence_trigger_kind" AS ENUM ('manual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "sequences"
  ADD COLUMN IF NOT EXISTS "trigger_kind" "sequence_trigger_kind"
    NOT NULL DEFAULT 'manual';

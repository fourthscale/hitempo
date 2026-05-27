-- Sprint 05 follow-up : link interactions to the task they were logged from.
-- Originally applied manually via psql before being committed as a migration,
-- hence the IF NOT EXISTS clauses — keeps the migration idempotent so
-- `supabase db push` succeeds on any environment regardless of prior state.

ALTER TABLE "interactions" ADD COLUMN IF NOT EXISTS "task_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_interactions_task" ON "interactions" USING btree ("task_id");

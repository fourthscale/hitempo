-- Sprint 11 (sequences) — make current_step_id / step_id SOFT references.
--
-- Publish swaps the whole sequence_steps set, regenerating step ids. A hard FK
-- on sequence_enrolments.current_step_id would block that swap, and the FK on
-- sequence_step_executions.step_id would either block the swap or (with cascade)
-- destroy the immutable audit trail. The engine resolves the live step by id
-- with a fallback to current_step_order, ending overshoot enrolments as
-- completed_exhausted — so these references are intentionally soft.
--
-- Additive + idempotent : only drops constraints, safe to replay.

ALTER TABLE "sequence_enrolments"
  DROP CONSTRAINT IF EXISTS "sequence_enrolments_current_step_id_sequence_steps_id_fk";

ALTER TABLE "sequence_step_executions"
  DROP CONSTRAINT IF EXISTS "sequence_step_executions_step_id_sequence_steps_id_fk";

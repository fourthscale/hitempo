-- Sprint 11 (sequences) — extend the step action taxonomy (Klaviyo-style).
--
-- Additive only : ALTER TYPE ADD VALUE never drops existing values, so legacy
-- create_task_* / end_success stay valid. The new values back the reorganized
-- palette (send_email with AI/defined mode, phone_call, update_contact,
-- conditional_split / _switch) and a forward-compat send_linkedin.
--
-- PG15 allows ADD VALUE inside a transaction provided the value isn't used in
-- the same migration (we only declare it here). Idempotent via IF NOT EXISTS.

ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'send_email';
ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'phone_call';
ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'send_linkedin';
ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'update_contact';
ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'conditional_split';
ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'conditional_switch';

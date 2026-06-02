-- Sprint 12 — Per-sequence + per-step "AI message context scope" config.
--
-- Controls whether the AI message generator sees ALL interactions of the
-- company (legacy) or only those linked to the current sequence enrolment
-- (default). Default 'sequence' avoids the bug where the AI replies to a
-- parallel out-of-sequence thread instead of continuing the planned step.
--
-- Additive only. NOT NULL on `sequences.message_context_scope` with a
-- default ; nullable on `sequence_steps.message_context_scope` (inherit).
-- CHECK constraints mirror the application-layer `SEQUENCE_MESSAGE_CONTEXT_SCOPES`.

ALTER TABLE "sequences" ADD COLUMN IF NOT EXISTS "message_context_scope" text NOT NULL DEFAULT 'sequence';

ALTER TABLE "sequences" DROP CONSTRAINT IF EXISTS "sequences_message_context_scope_check";
ALTER TABLE "sequences"
  ADD CONSTRAINT "sequences_message_context_scope_check"
  CHECK ("message_context_scope" IN ('sequence', 'all'));

ALTER TABLE "sequence_steps" ADD COLUMN IF NOT EXISTS "message_context_scope" text;

ALTER TABLE "sequence_steps" DROP CONSTRAINT IF EXISTS "sequence_steps_message_context_scope_check";
ALTER TABLE "sequence_steps"
  ADD CONSTRAINT "sequence_steps_message_context_scope_check"
  CHECK ("message_context_scope" IS NULL OR "message_context_scope" IN ('sequence', 'all'));

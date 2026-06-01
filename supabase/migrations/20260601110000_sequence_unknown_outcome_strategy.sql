-- Sprint 11.5 / Slice D — sequence-level + per-step "what to do when an
-- inbound reply isn't yet qualified" strategy.
--
-- Additive, with safe defaults : existing sequences/steps adopt the
-- default `park` strategy, which preserves today's behavior (the engine
-- couldn't advance on a reply-dependent branch without an outcome anyway).
--
-- CHECK constraint kept narrow now : add new strategies by extending the
-- list and shipping a new migration. The application layer mirrors this
-- in `SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES`.

ALTER TABLE "sequences" ADD COLUMN IF NOT EXISTS "unknown_outcome_strategy" text NOT NULL DEFAULT 'park';

ALTER TABLE "sequences" DROP CONSTRAINT IF EXISTS "sequences_unknown_outcome_strategy_check";
ALTER TABLE "sequences"
  ADD CONSTRAINT "sequences_unknown_outcome_strategy_check"
  CHECK ("unknown_outcome_strategy" IN ('park', 'continue_default'));

ALTER TABLE "sequence_steps" ADD COLUMN IF NOT EXISTS "unknown_outcome_strategy" text;

ALTER TABLE "sequence_steps" DROP CONSTRAINT IF EXISTS "sequence_steps_unknown_outcome_strategy_check";
ALTER TABLE "sequence_steps"
  ADD CONSTRAINT "sequence_steps_unknown_outcome_strategy_check"
  CHECK ("unknown_outcome_strategy" IS NULL OR "unknown_outcome_strategy" IN ('park', 'continue_default'));

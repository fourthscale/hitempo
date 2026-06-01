-- Sprint 11.5 / Slice B — LLM intent classification of inbound replies.
--
-- Adds 4 nullable columns on `interactions` so the new `interactions/classify`
-- Inngest handler can persist the LLM's intent label, confidence (0-1),
-- short reasoning, and a processed-at timestamp (which doubles as the
-- idempotency guard — non-null = already attempted).
--
-- The label stays raw `text` (not an enum) so the classifier can return
-- forward-compatible labels without a future migration. The application
-- layer validates against `INTENT_LABELS` before applying any side-effect.
--
-- Additive only (all columns nullable, no defaults that backfill rows).

ALTER TABLE "interactions" ADD COLUMN IF NOT EXISTS "ai_intent_label" text;
ALTER TABLE "interactions" ADD COLUMN IF NOT EXISTS "ai_intent_confidence" numeric(4, 3);
ALTER TABLE "interactions" ADD COLUMN IF NOT EXISTS "ai_intent_reasoning" text;
ALTER TABLE "interactions" ADD COLUMN IF NOT EXISTS "ai_processed_at" timestamp with time zone;

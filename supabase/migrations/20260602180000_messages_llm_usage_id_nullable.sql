-- Sprint 12 phase 3 — make messages.llm_usage_id nullable.
--
-- Outbound messages rendered from a `defined`-mode sequence step (no
-- LLM call) have no `llm_usage` row to link to. Up to now the column
-- was NOT NULL because every send went through the AI orchestrator.
-- With the defined-message dialog landing, we relax the constraint.
--
-- Additive change : existing rows already have a value, the FK is
-- preserved, only the NOT NULL is dropped.
ALTER TABLE messages
  ALTER COLUMN llm_usage_id DROP NOT NULL;

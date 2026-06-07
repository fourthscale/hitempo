-- Sprint 15 — Gmail thread metadata for sequence email follow-ups.
--
-- Two additive concerns :
--   1. On `sequence_step_executions` : the engine captures the Gmail
--      thread / message id AFTER each successful `send_email` step, so a
--      later step in the same enrolment can resolve "what thread are we
--      in" with one indexed lookup.
--   2. On `tasks` : the engine stamps the chosen thread context at task
--      creation time, so the send-side path (Agent executor, manual
--      dialogs) reads two task columns and stays sequence-agnostic.

ALTER TABLE sequence_step_executions
  ADD COLUMN IF NOT EXISTS gmail_thread_id  text,
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS subject          text;

-- Partial index supports the "find the latest send_email step's thread
-- for this enrolment" lookup the threading resolver makes at task
-- creation. Ordered by executed_at DESC ⇒ matches the typical query.
CREATE INDEX IF NOT EXISTS idx_seq_executions_thread
  ON sequence_step_executions (enrolment_id, executed_at)
  WHERE gmail_thread_id IS NOT NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS gmail_thread_id            text,
  ADD COLUMN IF NOT EXISTS gmail_reply_to_message_id  text,
  ADD COLUMN IF NOT EXISTS subject                    text;

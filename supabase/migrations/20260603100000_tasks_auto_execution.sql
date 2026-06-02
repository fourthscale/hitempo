-- Sprint 12 phase 4 — agent auto-execution flow on sequence-driven tasks.
--
-- A sequence step whose `assignment.actor` is "agent" now produces a task
-- that the system processes itself (render template OR call LLM, send via
-- the assignee's Gmail, log, complete the task, advance the sequence).
-- We track that lifecycle on the task row so the UI can surface failures
-- and the human assignee can take over.
--
-- Additive change : nullable enum + two text/timestamp columns. Existing
-- tasks stay at NULL on all three (= "not an agent task").

CREATE TYPE task_auto_execution_status AS ENUM ('pending', 'succeeded', 'failed');

ALTER TABLE tasks
  ADD COLUMN auto_execution_status task_auto_execution_status,
  ADD COLUMN auto_execution_error  text,
  ADD COLUMN auto_execution_at     timestamptz;

-- Index used by the Inngest handler at wake-up to confirm the task is
-- still pending before re-acquiring it.
CREATE INDEX idx_tasks_auto_exec_status
  ON tasks (auto_execution_status);

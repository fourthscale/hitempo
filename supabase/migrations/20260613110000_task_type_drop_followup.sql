-- Sprint 14 — drop the `follow_up` value from the task_type enum.
--
-- Rationale : `follow_up` was an intent ("relance"), not a channel
-- (you can't relance without saying via email / linkedin / phone). The
-- relance intent now lives only on the AI side (`message_intent` enum
-- still has follow_up — that's the right place : it instructs the LLM,
-- not the task channel).
--
-- PG doesn't support `ALTER TYPE ... DROP VALUE`, so we swap the enum :
-- create a new one without the value, repoint the column, drop the old
-- type, rename the new one back.
--
-- Verified : no `tasks.type = 'follow_up'` rows in prod at migration time
-- (run the SELECT count above before applying ; if the count is > 0,
-- decide on the data mapping before this migration runs).

create type task_type_new as enum ('email', 'linkedin', 'phone', 'visit', 'research', 'other');

alter table tasks
  alter column type type task_type_new using type::text::task_type_new;

drop type task_type;
alter type task_type_new rename to task_type;

-- Sprint 11.5 — allow `sequence_enrolments.next_due_at` to be NULL.
--
-- NULL is the explicit "indefinite wait" state set after a human-action step
-- (send_email / send_linkedin / phone_call). The cron sweep filters them out
-- via `next_due_at IS NOT NULL AND next_due_at <= now()`. Advancement happens
-- on the `sequences/task.completed` Inngest event instead.
--
-- Additive : drops a NOT NULL constraint. Existing rows are untouched. The
-- `idx_seq_enrolments_due` index continues to work — Postgres BTREE indexes
-- include NULL entries by default (they sort last) and the IS NOT NULL
-- predicate in the sweep query keeps planner usage of the index.

alter table sequence_enrolments
  alter column next_due_at drop not null;

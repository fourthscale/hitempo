-- Sprint 15 — full RFC 5322 References chain on tasks.
--
-- Until now the engine stamped only `gmail_reply_to_message_id` (immediate
-- parent) on a threaded task. RFC 5322 §3.6.4 says References must carry the
-- full ancestry chain (oldest → newest, space-separated message-ids with
-- angle brackets). The ThreadingResolver now builds that chain from every
-- prior `sequence_step_executions` row of the enrolment that has a
-- `gmail_message_id`, and stamps the result here for the send-side path to
-- emit verbatim in the References header.
--
-- NULL on fresh-thread sends and non-email tasks (the send-side falls back
-- to In-Reply-To only).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS mail_references text;

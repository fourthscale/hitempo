-- Sprint 14 — credential lifecycle for Gmail OAuth + agent task failure
-- classification.
--
-- Adds a tracked status on `user_gmail_credentials` (active / revoked)
-- so the agent executor and the profile UI can distinguish "your refresh
-- token died" from "your Gmail is connected and ready". When the
-- credential is revoked the OAuth callback also replays any agent tasks
-- that failed for this exact reason — see app/api/auth/gmail/callback.
--
-- Also adds `tasks.auto_execution_failure_kind` so the replay only fires
-- on gmail-auth-failed tasks (not LLM / network / logic errors that won't
-- be cured by reconnecting Gmail).
--
-- Additive only — existing rows default to status='active', failure_kind
-- stays NULL. Safe to push without app downtime.

create type gmail_credential_status as enum ('active', 'revoked');

alter table user_gmail_credentials
  add column status gmail_credential_status not null default 'active',
  add column revoked_at timestamptz,
  add column last_refresh_error text,
  add column last_refresh_attempt_at timestamptz;

create index idx_gmail_creds_status on user_gmail_credentials(status);

alter table tasks
  add column auto_execution_failure_kind text;

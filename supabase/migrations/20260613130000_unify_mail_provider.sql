-- Sprint 16 — unify Gmail-specific tables/columns under a provider-agnostic
-- "mail" namespace. Adds a `provider` column to the credential row so the
-- same row shape supports Gmail and Outlook side-by-side.
--
-- All renames preserve data (Postgres RENAME is atomic). The provider
-- column is backfilled to 'gmail' for all existing rows because every
-- credential predating this sprint is by definition a Gmail one. We DROP
-- the default after backfill so future inserts MUST specify the provider
-- explicitly — keeps the application from accidentally creating
-- under-specified rows.
--
-- Safe to apply in production with traffic : all operations are metadata
-- changes (rename) or single-row UPDATEs.

------------------------------------------------------------------------
-- 1. Rename user_gmail_credentials → user_mail_credentials
------------------------------------------------------------------------

alter table user_gmail_credentials rename to user_mail_credentials;
alter index idx_gmail_creds_org rename to idx_mail_creds_org;
alter index idx_gmail_creds_status rename to idx_mail_creds_status;
alter type gmail_credential_status rename to mail_credential_status;

-- Add the provider column. NOT NULL with a default so the existing rows
-- can be filled in one shot ; we drop the default after the backfill so
-- future inserts must specify.
alter table user_mail_credentials
  add column provider text not null default 'gmail';

-- Belt-and-braces : confirm every existing row is now marked 'gmail'.
update user_mail_credentials set provider = 'gmail' where provider is null;

-- Drop the default so application code must specify the provider
-- explicitly on insert.
alter table user_mail_credentials
  alter column provider drop default;

-- Constrain the provider values at the DB layer. Cheap CHECK, easier to
-- extend than a pgEnum if we add a third provider later.
alter table user_mail_credentials
  add constraint user_mail_credentials_provider_check
  check (provider in ('gmail', 'outlook'));

-- Rename the user-facing address column from gmail_address →
-- email_address. The value is the user's Gmail address today,
-- Outlook address for Outlook users — same semantic.
alter table user_mail_credentials rename column gmail_address to email_address;

------------------------------------------------------------------------
-- 2. Rename gmail_* columns on messages
------------------------------------------------------------------------

alter table messages rename column gmail_thread_id  to mail_thread_id;
alter table messages rename column gmail_message_id to mail_message_id;

------------------------------------------------------------------------
-- 3. Rename gmail_* columns on tasks
------------------------------------------------------------------------

alter table tasks rename column gmail_thread_id            to mail_thread_id;
alter table tasks rename column gmail_reply_to_message_id  to mail_reply_to_message_id;

------------------------------------------------------------------------
-- 4. Rename gmail_* columns on sequence_step_executions + partial index
------------------------------------------------------------------------

alter table sequence_step_executions
  rename column gmail_thread_id  to mail_thread_id;
alter table sequence_step_executions
  rename column gmail_message_id to mail_message_id;

-- The partial index's predicate references the old column name. Postgres
-- doesn't automatically rewrite partial-index predicates on column
-- rename, so we recreate the index. Drizzle expects the name
-- `idx_seq_executions_thread` so we drop & recreate under the same
-- name with the new predicate.
drop index if exists idx_seq_executions_thread;
create index idx_seq_executions_thread
  on sequence_step_executions (enrolment_id, executed_at)
  where mail_thread_id is not null;

------------------------------------------------------------------------
-- 5. Rename failure kind on tasks.auto_execution_failure_kind
------------------------------------------------------------------------

update tasks
   set auto_execution_failure_kind = 'mail_auth'
 where auto_execution_failure_kind = 'gmail_auth';

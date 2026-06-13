/**
 * Typed error hierarchy for the mail subsystem (provider-agnostic).
 *
 * Sprint 16 — replaces / generalises the Gmail-specific errors that
 * lived in `lib/gmail/gmail-errors.ts`. Names lose the `Gmail` prefix
 * because every error type applies equally to Gmail and Outlook ; the
 * caller doesn't care which provider tripped, only the failure shape.
 *
 * The legacy `Gmail*` aliases are kept exported below for one sprint
 * so call sites don't have to be migrated all at once. They'll be
 * removed in sprint 17.
 */

export abstract class MailError extends Error {
  public readonly name = this.constructor.name;
}

/** No `user_mail_credentials` row for the given user. */
export class MailCredentialsNotFoundError extends MailError {
  constructor(userId: string) {
    super(`No mail credentials for user ${userId}`);
  }
}

/** OAuth-related failures (state mismatch, code exchange, refresh,
 *  etc.) other than `invalid_grant`. */
export class MailOAuthError extends MailError {}

/** A required mail-related env var is missing (Google OAuth client,
 *  Microsoft Graph client, encryption key, etc.). */
export class MissingMailEnvError extends MailError {
  constructor(varName: string) {
    super(`Missing required env var: ${varName}`);
  }
}

/** Provider API call failed (after token refresh, etc.). */
export class MailApiError extends MailError {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

/**
 * Sprint 14 — the refresh token has died (provider returned
 * `invalid_grant`). Distinct from `MailOAuthError` because callers
 * handle it differently : the agent executor classifies the failing
 * task as `mail_auth` so the OAuth callback can replay it on next
 * reconnect ; the UI surfaces a "Reconnect …" banner instead of a
 * generic error.
 *
 * Thrown only after we've confirmed the refresh died (not on
 * transient HTTP / network errors, which surface as plain MailOAuthError
 * and don't poison the credential row).
 */
export class MailCredentialRevokedError extends MailError {
  constructor(public readonly userId: string, public readonly raw: string) {
    super(`Mail refresh token revoked for user ${userId}: ${raw}`);
  }
}


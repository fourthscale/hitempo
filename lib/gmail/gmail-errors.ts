/**
 * Typed error hierarchy for the Gmail subsystem.
 *
 * Mirrors the convention used elsewhere (`AuthError`, `LlmError`, `DbError`) :
 * one abstract base, one concrete subclass per failure mode. Callers can
 * `instanceof` to handle individual cases.
 */

export abstract class GmailError extends Error {
  public readonly name = this.constructor.name;
}

/** No `user_gmail_credentials` row for the given user. */
export class GmailCredentialsNotFoundError extends GmailError {
  constructor(userId: string) {
    super(`No Gmail credentials for user ${userId}`);
  }
}

/** OAuth-related failures (state mismatch, code exchange, refresh, etc.). */
export class GmailOAuthError extends GmailError {}

/**
 * Sprint 14 — the refresh token has died (Google `invalid_grant`).
 * Distinct from `GmailOAuthError` because callers handle it differently :
 * the agent executor classifies the failing task as `gmail_auth` so the
 * OAuth callback can replay it on next reconnect ; the UI surfaces a
 * "Reconnect Gmail" banner instead of a generic error.
 *
 * Thrown only by `GmailService.ensureFreshAccessToken` after we've
 * confirmed the refresh died (not on transient HTTP / network errors,
 * which surface as plain GmailOAuthError and don't poison the credential
 * row).
 */
export class GmailCredentialRevokedError extends GmailError {
  constructor(public readonly userId: string, public readonly raw: string) {
    super(`Gmail refresh token revoked for user ${userId}: ${raw}`);
  }
}

/** A required Gmail env var is missing. */
export class MissingGmailEnvError extends GmailError {
  constructor(varName: string) {
    super(`Missing required env var: ${varName}`);
  }
}

/** Gmail API call failed (after token refresh, etc.). */
export class GmailApiError extends GmailError {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

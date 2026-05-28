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

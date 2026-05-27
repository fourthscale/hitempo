/**
 * Typed error hierarchy for the database access layer.
 *
 * Mirrors `lib/ai/errors.ts` and `lib/auth/auth-errors.ts`. Any failure
 * raised by `DbClient` (or its factory) surfaces a subclass with a stable
 * `code`, so callers can branch / Sentry-tag without string-matching.
 */

export abstract class DbError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * The expected environment variable for a connection URL is missing or
 * empty at the moment `DbClient` was asked to open that pool.
 */
export class DbMissingUrlError extends DbError {
  public readonly code = "DB_MISSING_URL";

  constructor(public readonly envVar: string) {
    super(`${envVar} is required to open a database connection`);
  }
}

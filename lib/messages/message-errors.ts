/**
 * Typed error hierarchy for the message generation domain.
 *
 * Mirrors the patterns used in `lib/ai/errors.ts` and `lib/auth/auth-errors.ts`.
 * Every failure path in `MessageGenerationOrchestrator` raises a subclass with
 * a stable `code` so the action layer (and Sentry, when wired) can dispatch
 * without string-matching `error.message`.
 *
 * Note: `BrandBriefMissingError` lives in `lib/ai/errors.ts` already (it's
 * raised by the prompt-building pipeline) and propagates through the
 * orchestrator unchanged. It is NOT re-exported here.
 */

export abstract class MessageGenerationError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** The contactId in the action input doesn't resolve to a row in this org. */
export class ContactNotFoundError extends MessageGenerationError {
  public readonly code = "CONTACT_NOT_FOUND";

  constructor(public readonly contactId: string) {
    super(`Contact not found: ${contactId}`);
  }
}

/** The companyId in the action input doesn't resolve to a row in this org. */
export class CompanyNotFoundError extends MessageGenerationError {
  public readonly code = "COMPANY_NOT_FOUND";

  constructor(public readonly companyId: string) {
    super(`Company not found: ${companyId}`);
  }
}

/**
 * The `messages` row insert returned no row, OR the follow-up backref patch
 * on `llm_usage` failed. Both should never happen — typed for observability.
 */
export class MessagePersistError extends MessageGenerationError {
  public readonly code = "MESSAGE_PERSIST";

  constructor(message: string, options?: { cause?: unknown }) {
    super(`Failed to persist message: ${message}`, options);
  }
}

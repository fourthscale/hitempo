import type { ZodError } from "zod";

/**
 * Marker base class for ANY action error the user should see as a modal.
 *
 * Every Server Action error that we want surfaced as a friendly modal —
 * rather than the App Router full-page error boundary — extends this class.
 * The `wrapActionError` helper (`lib/actions/wrap-action-error.ts`) uses an
 * `instanceof UserFacingActionError` check to decide whether to redirect
 * with `?action_error=<code>` or re-throw to the error boundary.
 *
 * Domain-specific subclasses (admin, messages, …) extend this class for
 * their user-facing failures. System errors (e.g. `CreateOrgFailedError`,
 * unexpected DB issues) extend plain `Error` so they bubble normally.
 *
 * Subclasses may set `redirectParams` to carry contextual data into the
 * URL — for instance `{ email: "x@y.com" }` for "already a member" so the
 * modal can name the offender.
 */
export abstract class UserFacingActionError extends Error {
  public abstract readonly code: string;
  /** Extra query-string params merged into the redirect URL. Optional. */
  public readonly redirectParams?: Readonly<Record<string, string>>;

  protected constructor(
    message: string,
    options?: { cause?: unknown; redirectParams?: Record<string, string> },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    if (options?.redirectParams) {
      this.redirectParams = Object.freeze({ ...options.redirectParams });
    }
  }
}

// ---------------------------------------------------------------------------
// Shared subclasses used by multiple action domains.
// Domain-specific errors live alongside their owning action file
// (e.g. admin-action-errors.ts, message-action-errors.ts).
// ---------------------------------------------------------------------------

/**
 * The FormData failed Zod validation. Carries the ZodError as `cause` so
 * a debug surface can render field-level issues if needed.
 *
 * Every Server Action should throw this on `safeParse().success === false`.
 */
export class InvalidInputError extends UserFacingActionError {
  public readonly code = "INVALID_INPUT";
  constructor(public readonly zodError?: ZodError) {
    super("Invalid input", { cause: zodError });
  }
}

/**
 * Generic "you don't have access" — caller is authenticated but lacks the
 * permission this action requires. Distinct from auth failure (sign-in flow).
 */
export class ForbiddenError extends UserFacingActionError {
  public readonly code = "FORBIDDEN";
  constructor(message = "Forbidden") {
    super(message);
  }
}

/**
 * The target entity doesn't exist (or doesn't belong to the active tenant).
 * `entity` is a short kind tag (e.g. "interaction", "company") used for the
 * i18n message key — `actionErrors.not_found.<entity>` falls back to a
 * generic key when no per-entity variant exists.
 */
export class NotFoundError extends UserFacingActionError {
  public readonly code = "NOT_FOUND";
  constructor(public readonly entity: string, public readonly id?: string) {
    super(`${entity} not found${id ? ": " + id : ""}`, {
      redirectParams: { entity },
    });
  }
}

import {
  ForbiddenError,
  InvalidInputError,
  UserFacingActionError,
} from "./user-facing-action-error";

/**
 * Domain-specific errors for the platform-admin Server Actions.
 *
 * Split into two trees by concern :
 *   - **user-facing** subclasses extend `UserFacingActionError` so
 *     `wrapActionError` redirects with `?action_error=<code>` and the
 *     global `<ActionErrorModal />` renders a localized message
 *   - **system** subclasses extend plain `Error` and bubble to the App
 *     Router error boundary (genuine anomalies, security signals)
 *
 * `InvalidInputError` and `ForbiddenError` live in the shared file and
 * are re-exported here for ergonomic imports from action sites.
 */

export { InvalidInputError, ForbiddenError, UserFacingActionError };

// ---------------------------------------------------------------------------
// User-facing : redirect + modal
// ---------------------------------------------------------------------------

/** The submitted org name normalizes to an empty slug. */
export class AdminActionInvalidSlugError extends UserFacingActionError {
  public readonly code = "INVALID_SLUG";
  constructor() {
    super("Invalid slug: org name does not produce a valid slug");
  }
}

/** Tried to invite a user who is already a member of the target org. */
export class AdminActionAlreadyMemberError extends UserFacingActionError {
  public readonly code = "ALREADY_MEMBER";
  constructor(public readonly email: string) {
    super(`User already a member: ${email}`, {
      redirectParams: { email },
    });
  }
}

/** Platform admin tried to revoke their own platform-admin grant. */
export class AdminActionCannotRevokeSelfError extends UserFacingActionError {
  public readonly code = "CANNOT_REVOKE_SELF";
  constructor() {
    super("Cannot revoke your own platform-admin grant");
  }
}

/** Specialization of ForbiddenError for the platform-admin gate. */
export class AdminActionNotPlatformAdminError extends UserFacingActionError {
  public readonly code = "FORBIDDEN_NOT_PLATFORM_ADMIN";
  constructor() {
    super("Caller is not a platform admin");
  }
}

// ---------------------------------------------------------------------------
// System : bubble to error boundary
// ---------------------------------------------------------------------------

/** The `organizations` insert returned no row — never expected. */
export class AdminActionCreateOrgFailedError extends Error {
  public readonly code = "CREATE_ORG_FAILED";
  constructor() {
    super("Failed to create organization: insert returned no row");
    this.name = this.constructor.name;
  }
}

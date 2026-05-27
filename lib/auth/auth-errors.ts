/**
 * Typed error hierarchy for the Auth subsystem.
 *
 * Mirrors the pattern used in `lib/ai/errors.ts`. Every error coming out of
 * `AuthUserService` is a subclass of `AuthServiceError` with a stable `code`,
 * so the caller can switch on `code` instead of inspecting `error.message`.
 *
 * The Supabase Auth admin API is the underlying boundary — when it fails, we
 * wrap the failure here with a code that maps to the operation that was tried.
 */

export abstract class AuthServiceError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** `supabase.auth.admin.listUsers` failed. */
export class AuthListUsersError extends AuthServiceError {
  public readonly code = "AUTH_LIST_USERS";
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Failed to list auth users: ${message}`, options);
  }
}

/** `supabase.auth.admin.inviteUserByEmail` failed (or returned no user). */
export class AuthInviteError extends AuthServiceError {
  public readonly code = "AUTH_INVITE";
  constructor(
    public readonly email: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Failed to invite ${email}: ${message}`, options);
  }
}

/** `supabase.auth.admin.updateUserById` failed. */
export class AuthUpdateMetadataError extends AuthServiceError {
  public readonly code = "AUTH_UPDATE_METADATA";
  constructor(
    public readonly userId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Failed to update metadata for ${userId}: ${message}`, options);
  }
}

/** `supabase.auth.admin.generateLink` failed for type=invite. */
export class AuthReinviteError extends AuthServiceError {
  public readonly code = "AUTH_REINVITE";
  constructor(
    public readonly email: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Failed to re-send invite to ${email}: ${message}`, options);
  }
}

/** `supabase.auth.admin.generateLink` failed for type=magiclink. Non-fatal in practice. */
export class AuthMagicLinkError extends AuthServiceError {
  public readonly code = "AUTH_MAGIC_LINK";
  constructor(
    public readonly email: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Failed to send magic link to ${email}: ${message}`, options);
  }
}

/** `supabase.auth.admin.deleteUser` failed. */
export class AuthDeleteUserError extends AuthServiceError {
  public readonly code = "AUTH_DELETE_USER";
  constructor(
    public readonly userId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Failed to delete auth user ${userId}: ${message}`, options);
  }
}

import {
  InvalidInputError,
  UserFacingActionError,
} from "./user-facing-action-error";

/**
 * Domain-specific user-facing errors for `lib/actions/sequences.ts`.
 *
 * All extend `UserFacingActionError` so the global `<ActionErrorModal />`
 * surfaces them as a localized dialog (codes map to `actionErrors.<code>`
 * i18n keys). Engine/domain-internal errors (unknown predicate/action type)
 * live in `lib/sequences/sequence-errors.ts` and are NOT user-facing.
 */

export { InvalidInputError, UserFacingActionError };

/** The sequence doesn't exist in the active org (or was soft-deleted). */
export class SequenceNotFoundError extends UserFacingActionError {
  public readonly code = "SEQUENCE_NOT_FOUND";
  constructor(public readonly sequenceId: string) {
    super(`Sequence not found: ${sequenceId}`);
  }
}

/**
 * Another user holds the editing lock (and it isn't stale). Carries the
 * holder id so the modal can name them if the UI resolves it.
 */
export class SequenceLockedError extends UserFacingActionError {
  public readonly code = "SEQUENCE_LOCKED";
  constructor(public readonly lockedBy: string) {
    super(`Sequence is being edited by another user`, {
      redirectParams: { lockedBy },
    });
  }
}

/**
 * Publish was attempted on a draft that fails graph validation. `reason`
 * is a short machine tag of the first blocking issue (for the modal); the
 * editor surfaces the full issue list inline before the user ever gets here.
 */
export class SequenceDraftInvalidError extends UserFacingActionError {
  public readonly code = "SEQUENCE_DRAFT_INVALID";
  constructor(public readonly reason: string) {
    super(`Sequence draft is invalid: ${reason}`, {
      redirectParams: { reason },
    });
  }
}

/** Publish/save attempted but there is no draft to act on. */
export class SequenceNoDraftError extends UserFacingActionError {
  public readonly code = "SEQUENCE_NO_DRAFT";
  constructor() {
    super("No draft to publish");
  }
}

/** The enrolment doesn't exist in the active org. */
export class EnrolmentNotFoundError extends UserFacingActionError {
  public readonly code = "ENROLMENT_NOT_FOUND";
  constructor(public readonly enrolmentId: string) {
    super(`Enrolment not found: ${enrolmentId}`);
  }
}

/**
 * The contact can't be enrolled — opted out or an exclusion guard tripped.
 * `reason` matches `SequenceIneligibilityReason` so the modal can explain.
 */
export class ContactNotEligibleError extends UserFacingActionError {
  public readonly code = "CONTACT_NOT_ELIGIBLE";
  constructor(public readonly reason: string) {
    super(`Contact not eligible for enrolment: ${reason}`, {
      redirectParams: { reason },
    });
  }
}

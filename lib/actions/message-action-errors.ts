import {
  InvalidInputError,
  UserFacingActionError,
} from "./user-facing-action-error";

/**
 * Domain-specific errors for `lib/actions/messages.ts`.
 *
 * Complements (does NOT replace) the orchestrator-level errors in
 * `lib/messages/message-errors.ts` — the orchestrator owns the AI/business-
 * logic pipeline failures (ContactNotFoundError, …), this file owns the
 * action-layer concerns (Zod validation, post-generation entity lookups,
 * side-effect insert failures).
 *
 * All subclasses are user-facing → they extend `UserFacingActionError` so
 * the global modal surfaces them.
 */

export { InvalidInputError, UserFacingActionError };

/**
 * The action operates on an existing `messages` row but the row can't
 * be found in this org. Either the message was deleted or the caller
 * is in the wrong tenant.
 */
export class MessageActionMessageNotFoundError extends UserFacingActionError {
  public readonly code = "MESSAGE_NOT_FOUND";
  constructor(public readonly messageId: string) {
    super(`Message not found: ${messageId}`);
  }
}

/**
 * The `interactions` insert for the auto-logged "sent" event returned no
 * row — should never happen, kept typed for observability.
 */
export class MessageActionInteractionInsertFailedError extends UserFacingActionError {
  public readonly code = "INTERACTION_INSERT_FAILED";
  constructor() {
    super("Failed to insert interaction for sent message");
  }
}

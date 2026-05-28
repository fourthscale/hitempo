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

/**
 * "Envoyer via Gmail" was clicked but the user has not connected Gmail
 * in /settings/profile. The UI normally hides the button in that case,
 * but the action is defensive against direct calls / stale dialogs.
 */
export class GmailNotConnectedError extends UserFacingActionError {
  public readonly code = "GMAIL_NOT_CONNECTED";
  constructor() {
    super("Gmail is not connected for this user");
  }
}

/** Contact has no email on file — cannot send. */
export class ContactEmailMissingError extends UserFacingActionError {
  public readonly code = "CONTACT_EMAIL_MISSING";
  constructor(public readonly contactId: string) {
    super(`Contact ${contactId} has no email address`);
  }
}

/** Gmail API rejected the send (rate limit, invalid recipient, etc). */
export class GmailSendFailedError extends UserFacingActionError {
  public readonly code = "GMAIL_SEND_FAILED";
  constructor(public readonly reason: string) {
    super(`Gmail send failed: ${reason}`);
  }
}

/** An uploaded attachment exceeded the per-file or per-message size cap,
 *  or used an unsupported MIME type. The dialog already validates these
 *  client-side ; this is defense-in-depth for direct action calls. */
export class AttachmentRejectedError extends UserFacingActionError {
  public readonly code = "ATTACHMENT_REJECTED";
  constructor(public readonly reason: string) {
    super(`Attachment rejected: ${reason}`);
  }
}

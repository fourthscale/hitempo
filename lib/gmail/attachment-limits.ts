/**
 * Shared limits for Gmail attachments. Used by both client (drag-and-drop
 * validation in the dialog) and server (action-level enforcement). The
 * Gmail API caps each `messages.send` request at ~25 MB after base64
 * encoding (which inflates payloads by ~33 %), so we cap pre-encoding
 * volume well below that to leave headroom for headers, the message body
 * and MIME multipart overhead.
 */

/** Max bytes per individual attachment (15 MB). */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Max number of attachments per outbound message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

/** Combined raw-bytes cap across all attachments on a single send (20 MB).
 *  After base64 encoding (~33 % overhead) this leaves us comfortably under
 *  the Gmail 25 MB request cap. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Allowed MIME types. PDF only for MVP — adding more requires a UI
 *  decision (icons, preview), not just an enum change. */
export const ALLOWED_ATTACHMENT_MIME_TYPES = ["application/pdf"] as const;

export type AllowedAttachmentMimeType = (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

export function isAllowedAttachmentMimeType(
  mimeType: string,
): mimeType is AllowedAttachmentMimeType {
  return (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType);
}

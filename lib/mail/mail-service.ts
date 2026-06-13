import "server-only";

import type { MimeAttachment } from "@/lib/gmail/mime-message-strategy";

/**
 * Provider-agnostic mail service contract. Sprint 16.
 *
 * Two implementations today : `GmailService` (Google Mail API) and
 * `OutlookService` (Microsoft Graph). The Facade `MailServiceFactory`
 * routes to the right one based on the user's stored credential
 * provider, so call sites never branch.
 *
 * Design notes :
 * - **Threading**. Gmail uses RFC 5322 In-Reply-To / References headers ;
 *   Outlook uses the server-side `conversationId` field. The interface
 *   exposes both knobs (`replyToThreadId`, `inReplyToMessageId`,
 *   `references`) — the Gmail impl uses all three, the Outlook impl
 *   only uses `replyToThreadId` (passes it as conversationId) and
 *   ignores the rest.
 * - **Canonical Message-ID**. Gmail rewrites the Message-ID
 *   server-side so the impl re-fetches it after send ; Outlook
 *   surfaces the canonical id directly in the send response. Both
 *   normalise the result behind `MailSendResult.messageId`.
 * - **Attachments**. Same MimeAttachment shape for both (it's just
 *   bytes + filename + content-type). The Outlook impl translates to
 *   Graph's attachment payload at send time.
 */
export type MailSendInput = {
  userId: string;
  to: string;
  subject: string;
  body: string;
  /** When set, sends the message inside the existing thread (used for
   *  follow-ups). Gmail : passed as `threadId`. Outlook : passed as
   *  `conversationId`. The first send in a new thread leaves this
   *  undefined and the provider creates a new thread automatically. */
  replyToThreadId?: string;
  /**
   * RFC 5322 Message-ID of the message we're replying to. Used by the
   * Gmail impl to emit `In-Reply-To` / `References` headers so the
   * recipient's client renders the message as a real reply. Ignored by
   * the Outlook impl (Graph's conversationId is the threading anchor).
   */
  inReplyToMessageId?: string;
  /**
   * Full RFC 5322 References chain. Space-separated message-ids (with
   * angle brackets), oldest → newest, INCLUDING the parent at the end.
   * Forwarded verbatim to the MIME builder by the Gmail impl. Ignored
   * by the Outlook impl.
   */
  references?: string;
  /** Optional PDF attachments. Caller is responsible for enforcing
   *  size and type limits. */
  attachments?: MimeAttachment[];
};

export type MailSendResult = {
  /** Provider-side thread identifier. Gmail : `threadId`. Outlook :
   *  `conversationId`. Stored on `messages.mail_thread_id`. */
  threadId: string;
  /** Canonical mail Message-ID assigned by the provider. Gmail :
   *  `<...@mail.gmail.com>` fetched via a follow-up `messages.get`.
   *  Outlook : `internetMessageId` from the Graph send response. This
   *  is what the recipient's mail client actually sees in
   *  `Message-ID:` and what follow-up sends MUST reference in
   *  `In-Reply-To` / `References` for cross-account threading. */
  messageId: string;
  /** The provider address the message was sent from (the user's
   *  connected mailbox). */
  fromAddress: string;
};

/**
 * Minimal shape of a single fetched message — used by reply pollers to
 * detect inbound replies. Both providers normalise to this shape.
 */
export type MailThreadMessage = {
  /** Provider's internal id for the message (Gmail short id, Outlook
   *  message id). Identifies the row inside the provider but is NOT
   *  the canonical Message-ID header. */
  internalId: string;
  /** Canonical RFC 5322 Message-ID header value. May be null if the
   *  provider didn't expose it (rare). */
  messageId: string | null;
  /** Author. */
  from: string | null;
  /** Snippet / preview body — first ~200 chars, no quotes. */
  snippet: string | null;
  /** Timestamp the message was received by the mailbox (epoch ms). */
  receivedAtMs: number;
};

export interface MailService {
  /** Stable provider id used in logs + UI labels. `"gmail"` | `"outlook"`. */
  readonly providerName: "gmail" | "outlook";

  /** Send an email on behalf of `input.userId`. Throws a typed
   *  `MailError` on failure (caller decides retry vs. surfaces UI). */
  send(input: MailSendInput): Promise<MailSendResult>;

  /** Fetch the messages in `threadId` chronologically. Used by the
   *  reply poller to detect new inbound messages since the last
   *  poll. */
  fetchThread(userId: string, threadId: string): Promise<MailThreadMessage[]>;
}

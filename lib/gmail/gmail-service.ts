import "server-only";

import { randomUUID } from "node:crypto";
import {
  GmailCredentialsService,
  type DecryptedGmailCredentials,
} from "./gmail-credentials-service";
import { getGoogleOAuthConfig, refreshAccessToken } from "./google-oauth";
import { GmailApiError } from "./gmail-errors";
import { MimeMessageBuilder, type MimeAttachment } from "./mime-message-strategy";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Buffer used by the refresh path : we refresh proactively when the access
 * token has less than this much time left, to avoid 401s racing with API
 * calls that take a few hundred milliseconds.
 */
const EXPIRY_BUFFER_MS = 60_000;

export type GmailSendInput = {
  userId: string;
  to: string;
  subject: string;
  body: string;
  /** When set, sends the message inside the existing thread (used for
   *  follow-ups). The first send leaves this undefined and lets Gmail
   *  create a new thread. */
  replyToThreadId?: string;
  /**
   * Sprint 15 — Gmail RFC 5322 Message-ID of the message we're replying
   * to. Injected as the `In-Reply-To` and (V1) `References` MIME header
   * so the recipient's client renders this email as a real reply in the
   * same conversation. Required by the threading flow ; ignored when
   * `replyToThreadId` is omitted.
   */
  inReplyToMessageId?: string;
  /**
   * Sprint 15 — full RFC 5322 References chain. Space-separated message-ids
   * (with angle brackets), oldest → newest, INCLUDING the parent at the end.
   * Forwarded verbatim to the MIME builder so the recipient's client can
   * splice the message into the right conversation when there are 2+ hops.
   * Falls back to a single-id References header when omitted.
   */
  references?: string;
  /** Optional PDF attachments. Caller is responsible for enforcing size
   *  and type limits (see lib/gmail/attachment-limits.ts) — this layer
   *  trusts the bytes it's handed and only encodes them into MIME. */
  attachments?: MimeAttachment[];
};

export type GmailSendResult = {
  threadId: string;
  /** RFC 5322 Message-ID we stamped on the outgoing message (`<uuid@domain>`).
   *  This is what the recipient's mail client sees in the `Message-ID:`
   *  header — and what subsequent follow-ups MUST reference in their
   *  `In-Reply-To:` / `References:` headers for threading to work in the
   *  recipient's inbox. NOT to be confused with Gmail's internal short
   *  message id (returned in the send response as `json.id`) which we no
   *  longer expose because it's useless for cross-client threading. */
  messageId: string;
  fromAddress: string;
};

/**
 * Send + (later, Slice C) read facade for the Gmail API. Strategy-ready :
 * an OutlookService / SmtpService with the same surface can be added when
 * we support multiple senders, without changing call sites.
 *
 * Token refresh is handled here, not in `GmailCredentialsService`, because
 * it belongs to the "use the credentials" lifecycle — the credentials
 * service stays a pure CRUD layer.
 */
export class GmailService {
  constructor(
    private readonly credentials: GmailCredentialsService,
    private readonly siteUrl: string,
  ) {}

  public async send(input: GmailSendInput): Promise<GmailSendResult> {
    const creds = await this.credentials.requireForUser(input.userId);
    const accessToken = await this.ensureFreshAccessToken(creds);

    // Sprint 15 bugfix — generate the RFC 5322 Message-ID ourselves so we
    // know the EXACT value the recipient's `Message-ID:` header will carry.
    // Gmail's `messages.send` response returns its own internal short id
    // (`json.id`) which is NOT what ends up in the outgoing Message-ID
    // header — using `json.id` as the In-Reply-To target on a follow-up
    // breaks threading (the recipient's Gmail can't match the reference
    // to any real message). Caller-supplied Message-IDs are respected by
    // Gmail and not rewritten ; using our own UUID gives us a stable
    // canonical id we can persist and reference forever.
    //
    // Domain part = sender's gmail address domain (typically gmail.com
    // or the workspace domain). RFC 2822 requires <local@domain> ;
    // Gmail accepts any well-formed value.
    const domain = creds.gmailAddress.split("@")[1] || "hitempo.app";
    const selfMessageId = `<${randomUUID()}@${domain}>`;

    const mimeInput = {
      from: creds.gmailAddress,
      to: input.to,
      subject: input.subject,
      body: input.body,
      attachments: input.attachments,
      inReplyToMessageId: input.inReplyToMessageId,
      references: input.references,
      selfMessageId,
    };
    const raw = MimeMessageBuilder.forInput(mimeInput).build(mimeInput);

    const requestBody: { raw: string; threadId?: string } = { raw };
    if (input.replyToThreadId) requestBody.threadId = input.replyToThreadId;

    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new GmailApiError(`Gmail send failed (${res.status}): ${errBody}`, res.status);
    }

    const json = (await res.json()) as { id: string; threadId: string };

    // Fire-and-forget : missing last_used_at update isn't worth surfacing.
    void this.credentials.markUsed(input.userId).catch(() => undefined);

    return {
      threadId: json.threadId,
      // Return the RFC 5322 Message-ID we just stamped, NOT Gmail's
      // internal id. Persisted as `gmail_message_id` on step_executions —
      // the next step's threading resolver reads this to build
      // In-Reply-To + References headers that the recipient's mail client
      // can actually match.
      messageId: selfMessageId,
      fromAddress: creds.gmailAddress,
    };
  }

  /**
   * Returns a valid access token. Refreshes proactively if we're within
   * `EXPIRY_BUFFER_MS` of expiry. The refreshed token is persisted before
   * being returned, so the next call (this request or a concurrent one)
   * sees the updated `expires_at` on the row.
   */
  private async ensureFreshAccessToken(
    creds: DecryptedGmailCredentials,
  ): Promise<string> {
    if (creds.expiresAt.getTime() - Date.now() > EXPIRY_BUFFER_MS) {
      return creds.accessToken;
    }
    const config = getGoogleOAuthConfig(this.siteUrl);
    const refreshed = await refreshAccessToken(config, creds.refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await this.credentials.updateAccessToken(
      creds.userId,
      refreshed.access_token,
      newExpiresAt,
    );
    return refreshed.access_token;
  }
}


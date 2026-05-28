import "server-only";

import {
  GmailCredentialsService,
  type DecryptedGmailCredentials,
} from "./gmail-credentials-service";
import { getGoogleOAuthConfig, refreshAccessToken } from "./google-oauth";
import { GmailApiError } from "./gmail-errors";

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
};

export type GmailSendResult = {
  threadId: string;
  /** Gmail's internal message id — used to dedupe and to fetch the thread
   *  later from the reply-polling job. */
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

    const raw = buildMimeMessage({
      from: creds.gmailAddress,
      to: input.to,
      subject: input.subject,
      body: input.body,
    });

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
      messageId: json.id,
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

// ---------------------------------------------------------------------------
// MIME builder (private to this module)
// ---------------------------------------------------------------------------

/**
 * Builds an RFC 2822 message and returns it URL-safe-base64 encoded, the
 * exact format `users.messages.send` expects in its `raw` field.
 *
 * - Subject is RFC 2047 encoded when it contains non-ASCII.
 * - Body is sent as plain text UTF-8, transfer-encoded base64. We don't ship
 *   HTML in MVP — keeps deliverability simple and matches the AI generator.
 */
function buildMimeMessage(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const subject = needsRfc2047(input.subject)
    ? encodeRfc2047(input.subject)
    : input.subject;

  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].join("\r\n");

  const bodyB64 = Buffer.from(input.body, "utf8").toString("base64");
  const message = `${headers}\r\n\r\n${bodyB64}`;

  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function needsRfc2047(s: string): boolean {
  return /[^\x20-\x7E]/.test(s);
}

function encodeRfc2047(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

import "server-only";

import {
  GmailCredentialsService,
  type DecryptedGmailCredentials,
} from "./gmail-credentials-service";
import { getGoogleOAuthConfig, refreshAccessToken } from "./google-oauth";
import {
  GmailApiError,
  GmailCredentialRevokedError,
  GmailOAuthError,
} from "./gmail-errors";
import { MimeMessageBuilder, type MimeAttachment } from "./mime-message-strategy";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_GET_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

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
  /** RFC 5322 Message-ID Gmail assigned to the outgoing message
   *  (`<CABc...@mail.gmail.com>` style). Fetched via a follow-up
   *  `messages.get` call right after the send because Gmail rewrites
   *  any caller-supplied Message-ID server-side. This is what the
   *  recipient's mail client actually sees in `Message-ID:` — and what
   *  follow-up sends MUST reference in `In-Reply-To` / `References`
   *  for cross-account threading to work. NOT to be confused with
   *  Gmail's internal short id (`json.id` from the send response),
   *  which is per-account and useless for threading.
   *
   *  On failure of the canonical fetch, this falls back to the
   *  internal short id — threading will be broken on that follow-up
   *  but the row is still populated (failure mode logged client-side). */
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

    const mimeInput = {
      from: creds.gmailAddress,
      to: input.to,
      subject: input.subject,
      body: input.body,
      attachments: input.attachments,
      inReplyToMessageId: input.inReplyToMessageId,
      references: input.references,
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

    // Sprint 15 bugfix — Gmail rewrites the outgoing `Message-ID:` header
    // server-side (to its own `CABc...@mail.gmail.com` format), even when
    // we provide one in the raw MIME. The value the recipient sees is NOT
    // what we sent. Two prior attempts to stamp our own Message-ID via the
    // MIME builder failed silently because Gmail just replaces it. We
    // confirmed this by inspecting the raw headers of a received email.
    //
    // The only reliable way to capture the canonical Message-ID is to
    // fetch the message back via `messages.get` (metadata-only — cheap,
    // ~50 ms one-shot call) and read the actual `Message-ID:` header from
    // the response. We persist THAT, so the next step's threading resolver
    // builds `In-Reply-To` / `References` headers the recipient can
    // actually match.
    //
    // Requires `gmail.readonly` (or `gmail.metadata`) scope ; we already
    // request both `gmail.send` and `gmail.readonly`, so no scope change.
    const canonicalMessageId = await this.fetchCanonicalMessageId(accessToken, json.id);

    return {
      threadId: json.threadId,
      messageId: canonicalMessageId ?? json.id, // fall back to the internal id ;
      // threading will be broken in that case but the row still has a value.
      fromAddress: creds.gmailAddress,
    };
  }

  /**
   * Sprint 15 — fetch the RFC 5322 `Message-ID:` header Gmail assigned to a
   * message we just sent. Returns null on any failure ; the caller falls
   * back to Gmail's internal short id (threading won't work but the row
   * isn't lost).
   */
  private async fetchCanonicalMessageId(
    accessToken: string,
    gmailInternalId: string,
  ): Promise<string | null> {
    try {
      const url = `${GMAIL_GET_URL}/${gmailInternalId}?format=metadata&metadataHeaders=Message-ID`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      };
      const headers = json.payload?.headers ?? [];
      // Gmail returns the header name case-preserved as `Message-Id` (or
      // sometimes `Message-ID`) — match case-insensitively.
      const header = headers.find(
        (h) => typeof h.name === "string" && h.name.toLowerCase() === "message-id",
      );
      return header?.value ?? null;
    } catch {
      return null;
    }
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
    let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      refreshed = await refreshAccessToken(config, creds.refreshToken);
    } catch (err) {
      // Sprint 14 — distinguish "refresh token is dead" (Google
      // `invalid_grant`) from a transient HTTP / network failure.
      //
      // `invalid_grant` covers : refresh token expired (Testing mode
      // 7-day window), user revoked access in their Google account,
      // password change, workspace admin force-disconnect, > 50 tokens
      // issued for the same (client, user) pair, etc. None of these
      // are recoverable without a fresh OAuth consent — so we mark the
      // credential row revoked + throw a typed error that the executor
      // catches and classifies as `gmail_auth`. The OAuth callback
      // replays those tasks on next reconnect.
      //
      // Anything else (5xx, network timeout, malformed response) is
      // re-raised as-is so the call site retries naturally on the next
      // attempt without poisoning the credential row.
      if (err instanceof GmailOAuthError && /invalid_grant/i.test(err.message)) {
        await this.credentials
          .markRevoked(creds.userId, err.message)
          .catch((markErr) =>
            console.error(
              "[GmailService] markRevoked failed (non-fatal)",
              markErr,
            ),
          );
        throw new GmailCredentialRevokedError(creds.userId, err.message);
      }
      throw err;
    }
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await this.credentials.updateAccessToken(
      creds.userId,
      refreshed.access_token,
      newExpiresAt,
    );
    return refreshed.access_token;
  }
}


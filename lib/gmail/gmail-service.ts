import "server-only";

import {
  MailCredentialsService,
  type DecryptedMailCredentials,
} from "@/lib/mail/mail-credentials-service";
import type {
  MailService,
  MailSendInput,
  MailSendResult,
  MailThreadMessage,
} from "@/lib/mail/mail-service";
import {
  MailApiError,
  MailCredentialRevokedError,
  MailOAuthError,
} from "@/lib/mail/mail-errors";
import { getGoogleOAuthConfig, refreshAccessToken } from "./google-oauth";
import { MimeMessageBuilder } from "./mime-message-strategy";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_GET_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

/**
 * Buffer used by the refresh path : we refresh proactively when the access
 * token has less than this much time left, to avoid 401s racing with API
 * calls that take a few hundred milliseconds.
 */
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Send + read facade for the Gmail API. Sprint 16 — implements the
 * provider-agnostic `MailService` interface so call sites can target
 * the interface and the `MailServiceFactory` routes to this impl or
 * `OutlookService` based on the user's stored provider.
 *
 * Token refresh is handled here, not in `MailCredentialsService`,
 * because it belongs to the "use the credentials" lifecycle — the
 * credentials service stays a pure CRUD layer.
 */
export class GmailService implements MailService {
  public readonly providerName = "gmail" as const;

  constructor(
    private readonly credentials: MailCredentialsService,
    private readonly siteUrl: string,
  ) {}

  public async send(input: MailSendInput): Promise<MailSendResult> {
    const creds = await this.credentials.requireForUser(input.userId);
    const accessToken = await this.ensureFreshAccessToken(creds);

    const mimeInput = {
      from: creds.emailAddress,
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
      throw new MailApiError(`Gmail send failed (${res.status}): ${errBody}`, res.status);
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
      fromAddress: creds.emailAddress,
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
   * Sprint 16 — MailService.fetchThread implementation. Returns the
   * messages of a Gmail thread normalised to the provider-agnostic
   * `MailThreadMessage` shape. Used by the reply poller.
   */
  public async fetchThread(
    userId: string,
    threadId: string,
  ): Promise<MailThreadMessage[]> {
    const creds = await this.credentials.requireForUser(userId);
    const accessToken = await this.ensureFreshAccessToken(creds);
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new MailApiError(
        `Gmail thread fetch failed (${res.status}): ${body}`,
        res.status,
      );
    }
    const json = (await res.json()) as {
      messages?: Array<{
        id?: string;
        internalDate?: string;
        snippet?: string;
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      }>;
    };
    return (json.messages ?? []).map((m) => {
      const headers = m.payload?.headers ?? [];
      const find = (name: string): string | null => {
        const lower = name.toLowerCase();
        const h = headers.find(
          (x) => typeof x.name === "string" && x.name.toLowerCase() === lower,
        );
        return h?.value ?? null;
      };
      const internalMs = Number(m.internalDate ?? 0);
      return {
        internalId: m.id ?? "",
        messageId: find("message-id"),
        from: find("from"),
        snippet: m.snippet ?? null,
        receivedAtMs: Number.isFinite(internalMs) ? internalMs : 0,
      };
    });
  }

  /**
   * Returns a valid access token. Refreshes proactively if we're within
   * `EXPIRY_BUFFER_MS` of expiry. The refreshed token is persisted before
   * being returned, so the next call (this request or a concurrent one)
   * sees the updated `expires_at` on the row.
   */
  private async ensureFreshAccessToken(
    creds: DecryptedMailCredentials,
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
      if (err instanceof MailOAuthError && /invalid_grant/i.test(err.message)) {
        await this.credentials
          .markRevoked(creds.userId, err.message)
          .catch((markErr) =>
            console.error(
              "[GmailService] markRevoked failed (non-fatal)",
              markErr,
            ),
          );
        throw new MailCredentialRevokedError(creds.userId, err.message);
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


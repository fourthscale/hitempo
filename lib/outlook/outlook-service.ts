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
import { getMsGraphOAuthConfig, refreshAccessToken } from "./ms-graph-oauth";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Outlook implementation of MailService — talks to Microsoft Graph.
 * Sprint 16.
 *
 * Key design notes vs Gmail :
 * - **Send** is a 2-step dance : POST /me/messages creates a draft
 *   (returns id + conversationId + internetMessageId synchronously),
 *   then POST /me/messages/{id}/send fires it. This buys us the
 *   canonical Message-ID without an extra GET like Gmail needs.
 * - **Threading** uses `conversationId` (Outlook-internal). We store
 *   it on `mail_thread_id`, the reply poller filters on it. Outlook
 *   threads messages with the same `conversationId` automatically
 *   when sent within the same conversation tree, even cross-folder.
 * - **Cross-provider threading** : Outlook's REST API does NOT let
 *   us set `In-Reply-To` / `References` headers from the send side
 *   (only `x-*` custom headers are allowed). So when an Outlook user
 *   sends a follow-up to a thread that originated on Gmail, the
 *   recipient's mail client won't see the explicit reply linkage —
 *   it'll fall back to subject-based threading. Acceptable for V1.
 * - **Refresh** : invalid_grant detection mirrors Gmail. Triggers
 *   markRevoked + throws MailCredentialRevokedError so the executor
 *   classifies the failure as `mail_auth` and the OAuth callback
 *   replays the queued agent tasks on next reconnect.
 */
export class OutlookService implements MailService {
  public readonly providerName = "outlook" as const;

  constructor(
    private readonly credentials: MailCredentialsService,
    private readonly siteUrl: string,
  ) {}

  public async send(input: MailSendInput): Promise<MailSendResult> {
    const creds = await this.credentials.requireForUser(input.userId);
    const accessToken = await this.ensureFreshAccessToken(creds);

    // Step 1 — create a draft. The response carries the canonical
    // internetMessageId + conversationId synchronously so we can
    // capture both before actually sending.
    //
    // Graph rejects unknown fields, so we shape the body strictly.
    const draftBody: Record<string, unknown> = {
      subject: input.subject,
      body: { contentType: "Text", content: input.body },
      toRecipients: [{ emailAddress: { address: input.to } }],
    };
    if (input.attachments && input.attachments.length > 0) {
      draftBody.attachments = input.attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.filename,
        contentType: att.mimeType,
        contentBytes: att.content.toString("base64"),
      }));
    }

    const draftRes = await fetch(`${GRAPH_BASE}/me/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(draftBody),
    });
    if (!draftRes.ok) {
      const errBody = await draftRes.text();
      throw new MailApiError(
        `Outlook draft create failed (${draftRes.status}): ${errBody}`,
        draftRes.status,
      );
    }
    const draft = (await draftRes.json()) as {
      id: string;
      conversationId?: string;
      internetMessageId?: string;
    };

    // Step 2 — send the draft. 202 Accepted, no body.
    const sendRes = await fetch(`${GRAPH_BASE}/me/messages/${draft.id}/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!sendRes.ok) {
      const errBody = await sendRes.text();
      throw new MailApiError(
        `Outlook send failed (${sendRes.status}): ${errBody}`,
        sendRes.status,
      );
    }

    void this.credentials.markUsed(input.userId).catch(() => undefined);

    return {
      threadId: draft.conversationId ?? draft.id,
      messageId: draft.internetMessageId ?? draft.id,
      fromAddress: creds.emailAddress,
    };
  }

  /**
   * Fetch the messages in a conversation. Used by the reply poller.
   * We query the user's Mail Folder (any folder) for messages where
   * conversationId matches, ordered chronologically.
   */
  public async fetchThread(
    userId: string,
    conversationId: string,
  ): Promise<MailThreadMessage[]> {
    const creds = await this.credentials.requireForUser(userId);
    const accessToken = await this.ensureFreshAccessToken(creds);

    const url = new URL(`${GRAPH_BASE}/me/messages`);
    url.searchParams.set(
      "$filter",
      `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
    );
    url.searchParams.set(
      "$select",
      "id,internetMessageId,from,bodyPreview,receivedDateTime",
    );
    url.searchParams.set("$orderby", "receivedDateTime asc");
    url.searchParams.set("$top", "50");

    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new MailApiError(
        `Outlook thread fetch failed (${res.status}): ${body}`,
        res.status,
      );
    }
    const json = (await res.json()) as {
      value?: Array<{
        id?: string;
        internetMessageId?: string;
        from?: { emailAddress?: { address?: string; name?: string } };
        bodyPreview?: string;
        receivedDateTime?: string;
      }>;
    };
    return (json.value ?? []).map((m) => ({
      internalId: m.id ?? "",
      messageId: m.internetMessageId ?? null,
      from: m.from?.emailAddress?.address ?? null,
      snippet: m.bodyPreview ?? null,
      receivedAtMs: m.receivedDateTime
        ? new Date(m.receivedDateTime).getTime()
        : 0,
    }));
  }

  /**
   * Returns a valid access token. Refreshes proactively if we're within
   * `EXPIRY_BUFFER_MS` of expiry. On `invalid_grant` (refresh token
   * dead — most likely cause for a 400 from the Graph token endpoint),
   * marks the credential revoked and throws MailCredentialRevokedError
   * so the executor classifies the failure as `mail_auth`.
   */
  private async ensureFreshAccessToken(
    creds: DecryptedMailCredentials,
  ): Promise<string> {
    if (creds.expiresAt.getTime() - Date.now() > EXPIRY_BUFFER_MS) {
      return creds.accessToken;
    }
    const config = getMsGraphOAuthConfig(this.siteUrl);
    let refreshed: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      refreshed = await refreshAccessToken(config, creds.refreshToken);
    } catch (err) {
      if (err instanceof MailOAuthError && /invalid_grant/i.test(err.message)) {
        await this.credentials
          .markRevoked(creds.userId, err.message)
          .catch((markErr) =>
            console.error(
              "[OutlookService] markRevoked failed (non-fatal)",
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

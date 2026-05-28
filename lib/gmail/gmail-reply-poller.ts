import "server-only";

import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { interactions, messages } from "@/db/schema";
import { logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import { cleanReplySnippet } from "@/lib/messages/clean-reply-snippet";
import type { GmailCredentialsService } from "./gmail-credentials-service";
import { getGoogleOAuthConfig, refreshAccessToken } from "./google-oauth";
import { GmailApiError } from "./gmail-errors";

const GMAIL_THREAD_URL = (threadId: string) =>
  `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Date`;

/** Don't poll messages older than this — assumes a reply after 14 days is rare
 *  enough that letting the user log it manually is better than burning quota. */
const POLL_LOOKBACK_DAYS = 14;

/** Refresh access token when within this window of expiry. */
const EXPIRY_BUFFER_MS = 60_000;

export type PollUserSummary = {
  userId: string;
  scanned: number;
  repliesDetected: number;
  errors: number;
};

type GmailThreadMessage = {
  id: string;
  threadId: string;
  internalDate: string; // ms since epoch as string
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
  snippet?: string;
};

type GmailThread = {
  id: string;
  messages?: GmailThreadMessage[];
};

/**
 * Scans every Gmail-tracked outbound message for the active user, fetches
 * its thread, and detects whether a new inbound message has arrived since
 * the outbound was sent. When a reply is found :
 *
 *   - `messages.reply_received_at` is set (acts as the "already detected"
 *      flag for future polls).
 *   - A new `interactions` row is inserted (channel=email, type=follow_up),
 *      with the snippet in `summary` and the Gmail ids in `metadata`.
 *   - The originating "Follow-up if no reply" task (if present) is
 *      auto-completed.
 *
 * Single responsibility : reply detection. The cron scheduling, fan-out
 * across users, and step-level retry policy live in the Inngest function
 * wrapper that calls this class.
 */
export class GmailReplyPoller {
  constructor(
    private readonly db: Db,
    private readonly credentials: GmailCredentialsService,
    private readonly siteUrl: string,
  ) {}

  /**
   * Returns the list of user ids that currently have Gmail connected.
   * The Inngest function fans out one step per user using this list.
   */
  public async listConnectedUserIds(): Promise<string[]> {
    const rows = await this.db.execute(
      sql`select distinct user_id::text as user_id from user_gmail_credentials`,
    );
    return (rows as unknown as Array<{ user_id: string }>).map((r) => r.user_id);
  }

  /**
   * Polls every pending-reply message owned by the given user. Designed to
   * be called inside an Inngest `step.run()` — any throw bubbles up so the
   * step is retried by Inngest with exponential backoff.
   */
  public async pollUser(userId: string): Promise<PollUserSummary> {
    const creds = await this.credentials.getForUser(userId);
    if (!creds) {
      return { userId, scanned: 0, repliesDetected: 0, errors: 0 };
    }

    const accessToken = await this.ensureFreshAccessToken(creds.accessToken, creds.refreshToken, creds.expiresAt, userId);

    const cutoff = new Date(Date.now() - POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const pending = await this.db.query.messages.findMany({
      where: and(
        eq(messages.userId, userId),
        eq(messages.status, "sent"),
        isNotNull(messages.gmailThreadId),
        isNull(messages.replyReceivedAt),
        isNotNull(messages.sentAt),
        // sentAt cutoff — drop very old messages we'll never see a reply on
        sql`${messages.sentAt} > ${cutoff.toISOString()}`,
      ),
      orderBy: (m, { asc, sql: s }) => [
        // Oldest poll first so we don't starve a row.
        // NULLS first via the COALESCE trick — `nulls first` is dialect-tricky in drizzle.
        s`coalesce(${m.lastPolledAt}, ${cutoff.toISOString()}::timestamptz)`,
        asc(m.sentAt),
      ],
      limit: 100, // hard cap per step run
    });

    let detected = 0;
    let errors = 0;

    for (const msg of pending) {
      try {
        const got = await this.checkOneMessage({
          messageRow: msg,
          accessToken,
          ownAddress: creds.gmailAddress,
        });
        if (got) detected += 1;
      } catch (err) {
        errors += 1;
        // Log but keep going. The row's last_polled_at is updated below
        // either way so we don't get stuck on one bad message.
        console.error("[gmail-reply-poller] message failed", {
          messageId: msg.id,
          threadId: msg.gmailThreadId,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await this.markPolled(msg.id);
      }
    }

    return { userId, scanned: pending.length, repliesDetected: detected, errors };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Inspects the Gmail thread and looks for any message newer than `sentAt`
   * whose `From` doesn't match the sender's own Gmail. The first match wins,
   * subsequent replies in the same thread are NOT logged (the user reads
   * the back-and-forth inside Gmail via the deep link).
   */
  private async checkOneMessage(args: {
    messageRow: typeof messages.$inferSelect;
    accessToken: string;
    ownAddress: string;
  }): Promise<boolean> {
    const { messageRow, accessToken, ownAddress } = args;
    if (!messageRow.gmailThreadId || !messageRow.sentAt) return false;

    const thread = await this.fetchThread(messageRow.gmailThreadId, accessToken);
    if (!thread.messages || thread.messages.length === 0) return false;

    const reply = thread.messages.find((m) => {
      const internalMs = Number(m.internalDate);
      if (!Number.isFinite(internalMs)) return false;
      if (internalMs <= messageRow.sentAt!.getTime()) return false;
      const from = headerValue(m, "From") ?? "";
      // We send from `ownAddress` (potentially with display name) — drop
      // anything whose From contains our address.
      return !from.toLowerCase().includes(ownAddress.toLowerCase());
    });

    if (!reply) return false;

    const rawSnippet = reply.snippet?.slice(0, 280) ?? null;
    const cleanSnippet = rawSnippet ? cleanReplySnippet(rawSnippet) : null;

    await this.recordReply({
      messageRow,
      gmailMessageId: reply.id,
      snippet: cleanSnippet,
      receivedAtMs: Number(reply.internalDate),
    });
    return true;
  }

  /**
   * Persists a detected reply : flips `reply_received_at` on the message,
   * inserts an inbound interaction with the snippet, and completes any
   * "follow-up if no reply" task linked through the message.
   */
  private async recordReply(args: {
    messageRow: typeof messages.$inferSelect;
    gmailMessageId: string;
    snippet: string | null;
    receivedAtMs: number;
  }): Promise<void> {
    const { messageRow, gmailMessageId, snippet, receivedAtMs } = args;
    const receivedAt = new Date(receivedAtMs);

    await this.db
      .update(messages)
      .set({ replyReceivedAt: receivedAt, updatedAt: new Date() })
      .where(eq(messages.id, messageRow.id));

    // Create the inbound interaction reflecting the received reply. The
    // outcome stays null — the user qualifies it (positive / negative /
    // rdv / etc) after reading the reply. No status on the reply : it's
    // an event, not a lifecycle.
    await logInteraction(
      messageRow.organizationId,
      messageRow.userId,
      {
        companyId: messageRow.companyId,
        contactId: messageRow.contactId,
        taskId: null,
        type: "email_received",
        channel: "email",
        outcome: null,
        summary: snippet,
        occurredAt: receivedAt,
        messageId: messageRow.id,
        metadata: {
          kind: "gmail_reply",
          gmail_thread_id: messageRow.gmailThreadId,
          gmail_message_id: gmailMessageId,
          original_message_id: messageRow.id,
        },
      },
      this.db,
    );

    // Flip the outbound's status from "sent" → "responded" so the timeline
    // can render the "↩ Répondu" badge without re-querying child rows.
    await this.db
      .update(interactions)
      .set({ status: "responded", updatedAt: new Date() })
      .where(
        and(
          eq(interactions.organizationId, messageRow.organizationId),
          eq(interactions.messageId, messageRow.id),
          eq(interactions.status, "sent"),
        ),
      );

    if (messageRow.taskId) {
      await completeTask(messageRow.organizationId, messageRow.taskId, messageRow.userId, this.db);
    }
  }

  private async markPolled(messageId: string): Promise<void> {
    await this.db
      .update(messages)
      .set({ lastPolledAt: new Date() })
      .where(eq(messages.id, messageId));
  }

  private async fetchThread(threadId: string, accessToken: string): Promise<GmailThread> {
    const res = await fetch(GMAIL_THREAD_URL(threadId), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GmailApiError(`Thread fetch failed (${res.status}): ${body}`, res.status);
    }
    return res.json() as Promise<GmailThread>;
  }

  /**
   * Same refresh-if-stale logic as `GmailService` — duplicated here on
   * purpose because the poller may run for many seconds and we want a
   * single refresh up-front rather than per-message.
   */
  private async ensureFreshAccessToken(
    accessToken: string,
    refreshToken: string,
    expiresAt: Date,
    userId: string,
  ): Promise<string> {
    if (expiresAt.getTime() - Date.now() > EXPIRY_BUFFER_MS) return accessToken;
    const config = getGoogleOAuthConfig(this.siteUrl);
    const refreshed = await refreshAccessToken(config, refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    await this.credentials.updateAccessToken(userId, refreshed.access_token, newExpiresAt);
    return refreshed.access_token;
  }
}

function headerValue(message: GmailThreadMessage, name: string): string | undefined {
  const lower = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

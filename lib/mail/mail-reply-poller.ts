import "server-only";

import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { interactions, messages } from "@/db/schema";
import { logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import { promoteContactStatus } from "@/lib/contacts/contact-status-promoter";
import { inngest } from "@/lib/inngest/client";
import { EVENT_CLASSIFY_INTERACTION } from "@/lib/ai/classification/events";
import { cleanReplySnippet } from "@/lib/messages/clean-reply-snippet";
import { MailCredentialsService } from "./mail-credentials-service";
import { MailServiceFactory } from "./mail-service-factory";
import { MailCredentialRevokedError } from "./mail-errors";

/** Don't poll messages older than this — assumes a reply after 14
 *  days is rare enough that letting the user log it manually is
 *  better than burning provider quota. */
const POLL_LOOKBACK_DAYS = 14;

export type PollUserSummary = {
  userId: string;
  scanned: number;
  repliesDetected: number;
  errors: number;
};

/**
 * Sprint 16 — provider-agnostic reply poller. Replaces the
 * Gmail-specific `GmailReplyPoller` ; routes per-user to either
 * `GmailService.fetchThread` or `OutlookService.fetchThread` via
 * `MailServiceFactory.forUser`.
 *
 * The recordReply persistence path is identical for both providers :
 *   - flip `messages.reply_received_at`
 *   - insert an inbound `email_received` interaction
 *   - flip the matching outbound interaction `status` to 'responded'
 *   - complete the linked task if any (the "follow-up if no reply"
 *     auto-task)
 *   - fire the LLM intent classification event
 *
 * Single responsibility : reply detection. Cron scheduling, fan-out
 * across users, and step-level retry policy live in the Inngest
 * function wrapper that calls this class.
 */
export class MailReplyPoller {
  constructor(
    private readonly db: Db,
    private readonly credentials: MailCredentialsService,
  ) {}

  /**
   * Returns the list of user ids that currently have a mail provider
   * connected (Gmail or Outlook). The Inngest function fans out one
   * step per user using this list.
   */
  public async listConnectedUserIds(): Promise<string[]> {
    const rows = await this.db.execute(
      sql`select distinct user_id::text as user_id from user_mail_credentials where status = 'active'`,
    );
    return (rows as unknown as Array<{ user_id: string }>).map((r) => r.user_id);
  }

  /**
   * Polls every pending-reply message owned by the given user. Designed
   * to be called inside an Inngest `step.run()` — any throw bubbles up
   * so the step is retried by Inngest with exponential backoff.
   *
   * `MailServiceFactory.forUser(userId)` resolves the right provider
   * implementation. If the credential is revoked (status='revoked' OR
   * a refresh attempt fails with invalid_grant during this poll), we
   * surface that as a zero-result run + log ; the rest of the user's
   * messages are skipped because they'd all fail the same way.
   */
  public async pollUser(userId: string): Promise<PollUserSummary> {
    let mail;
    try {
      mail = await MailServiceFactory.forUser(userId);
    } catch {
      // No credential or wrong shape — nothing to poll for this user.
      return { userId, scanned: 0, repliesDetected: 0, errors: 0 };
    }

    const creds = await this.credentials.getForUser(userId);
    if (!creds) {
      return { userId, scanned: 0, repliesDetected: 0, errors: 0 };
    }

    const cutoff = new Date(Date.now() - POLL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const pending = await this.db.query.messages.findMany({
      where: and(
        eq(messages.userId, userId),
        eq(messages.status, "sent"),
        isNotNull(messages.mailThreadId),
        isNull(messages.replyReceivedAt),
        isNotNull(messages.sentAt),
        // sentAt cutoff — drop very old messages we'll never see a reply on.
        sql`${messages.sentAt} > ${cutoff.toISOString()}`,
      ),
      orderBy: (m, { asc, sql: s }) => [
        // Oldest poll first so we don't starve a row. NULLS first via
        // the COALESCE trick — `nulls first` is dialect-tricky in
        // drizzle.
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
          mail,
          userId,
          ownAddress: creds.emailAddress,
        });
        if (got) detected += 1;
      } catch (err) {
        errors += 1;
        // Credential revoked mid-poll → no point continuing with this
        // user, but DO mark the messages as polled so we don't churn
        // the same rows next tick. The outer Inngest function logs the
        // error ; the UI will surface the revoked banner on next page
        // load via getConnectionStatus.
        if (err instanceof MailCredentialRevokedError) {
          console.error("[mail-reply-poller] credential revoked mid-poll", {
            userId,
            messageId: msg.id,
          });
          await this.markPolled(msg.id);
          break;
        }
        console.error("[mail-reply-poller] message failed", {
          messageId: msg.id,
          threadId: msg.mailThreadId,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await this.markPolled(msg.id);
      }
    }

    return { userId, scanned: pending.length, repliesDetected: detected, errors };
  }

  /**
   * Inspects the thread and looks for any message newer than `sentAt`
   * whose `From` doesn't match the sender's own address. First match
   * wins, subsequent replies in the same thread are NOT logged (the
   * user reads the back-and-forth inside their mail client).
   */
  private async checkOneMessage(args: {
    messageRow: typeof messages.$inferSelect;
    mail: Awaited<ReturnType<typeof MailServiceFactory.forUser>>;
    userId: string;
    ownAddress: string;
  }): Promise<boolean> {
    const { messageRow, mail, userId, ownAddress } = args;
    if (!messageRow.mailThreadId || !messageRow.sentAt) return false;

    const threadMessages = await mail.fetchThread(userId, messageRow.mailThreadId);
    if (threadMessages.length === 0) return false;

    const sentAtMs = messageRow.sentAt.getTime();
    const reply = threadMessages.find((m) => {
      if (m.receivedAtMs <= sentAtMs) return false;
      const from = (m.from ?? "").toLowerCase();
      // Drop anything whose From contains our own address (Gmail/Outlook
      // both echo the sent message in the thread).
      return !from.includes(ownAddress.toLowerCase());
    });

    if (!reply) return false;

    const rawSnippet = reply.snippet?.slice(0, 280) ?? null;
    const cleanSnippet = rawSnippet ? cleanReplySnippet(rawSnippet) : null;

    await this.recordReply({
      messageRow,
      providerInternalId: reply.internalId,
      snippet: cleanSnippet,
      receivedAtMs: reply.receivedAtMs,
      providerName: mail.providerName,
    });
    return true;
  }

  /**
   * Persists a detected reply : flips `reply_received_at` on the
   * message, inserts an inbound interaction with the snippet, and
   * completes any "follow-up if no reply" task linked through the
   * message.
   */
  private async recordReply(args: {
    messageRow: typeof messages.$inferSelect;
    providerInternalId: string;
    snippet: string | null;
    receivedAtMs: number;
    providerName: "gmail" | "outlook";
  }): Promise<void> {
    const { messageRow, providerInternalId, snippet, receivedAtMs, providerName } = args;
    const receivedAt = new Date(receivedAtMs);

    await this.db
      .update(messages)
      .set({ replyReceivedAt: receivedAt, updatedAt: new Date() })
      .where(eq(messages.id, messageRow.id));

    const inboundRow = await logInteraction(
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
          kind: `${providerName}_reply`,
          mail_thread_id: messageRow.mailThreadId,
          mail_message_id: providerInternalId,
          provider: providerName,
          original_message_id: messageRow.id,
        },
      },
      this.db,
    );

    // Flip the outbound's status from "sent" → "responded".
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
      await completeTask(
        messageRow.organizationId,
        messageRow.taskId,
        messageRow.userId,
        this.db,
      );
    }

    if (messageRow.contactId) {
      void promoteContactStatus(messageRow.organizationId, messageRow.contactId, {
        kind: "inbound_received",
      });
    }

    if (inboundRow?.id) {
      try {
        await inngest.send({
          name: EVENT_CLASSIFY_INTERACTION,
          data: {
            organizationId: messageRow.organizationId,
            interactionId: inboundRow.id,
          },
        });
      } catch (err) {
        console.error("[mail-reply-poller] failed to emit classify event", {
          interactionId: inboundRow.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async markPolled(messageId: string): Promise<void> {
    await this.db
      .update(messages)
      .set({ lastPolledAt: new Date() })
      .where(eq(messages.id, messageId));
  }
}

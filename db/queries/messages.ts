import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { messages } from "@/db/schema";
import type { MessageChannel, MessageIntent } from "@/lib/messages/types";

/**
 * The last N messages we generated for this contact, any status.
 * Used by the prompt builder to enforce anti-repetition.
 *
 * Multi-tenant : filters by organizationId.
 */
export async function getRecentMessagesByContact(
  orgId: string,
  contactId: string,
  limit = 5,
) {
  return getDb()
    .select({
      id: messages.id,
      createdAt: messages.createdAt,
      channel: messages.channel,
      intent: messages.intent,
      content: messages.content,
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.contactId, contactId),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

export type InsertMessageInput = {
  contactId: string;
  companyId: string;
  taskId: string | null;
  userId: string;
  channel: MessageChannel;
  intent: MessageIntent;
  locale: string;
  orientation: string | null;
  content: string;
  /**
   * FK to `llm_usage`. Nullable since Sprint 12 phase 3 — defined-mode
   * messages (rendered from a template, no LLM call) carry no usage row.
   * The AI flow always sets this to a real id.
   */
  llmUsageId: string | null;
  /** Always "sent" since the row is only created when the user commits.
   *  Kept as a parameter so the caller is explicit about it. */
  status?: "sent";
  sentAt?: Date;
  gmailThreadId?: string | null;
  gmailMessageId?: string | null;
};

/**
 * Inserts a `messages` row. The provenance fields (provider/model/tokens/cost)
 * live in llm_usage and are referenced through `llmUsageId`.
 *
 * In the new flow (sprint 10) the row is created **only when the user actually
 * commits** the message — either by sending via Gmail or by manually logging
 * the interaction. There is no longer a "draft" lifecycle.
 */
/**
 * `dbOverride` is honored so background jobs (Inngest agent auto-execution,
 * sequence engine) can run against the admin pool. User-driven callers pass
 * nothing and get the RLS-aware pool by default.
 */
export async function insertMessage(
  orgId: string,
  input: InsertMessageInput,
  dbOverride?: Db,
) {
  const db = dbOverride ?? getDb();
  const [row] = await db
    .insert(messages)
    .values({
      organizationId: orgId,
      contactId: input.contactId,
      companyId: input.companyId,
      taskId: input.taskId,
      userId: input.userId,
      channel: input.channel,
      intent: input.intent,
      locale: input.locale,
      orientation: input.orientation,
      content: input.content,
      llmUsageId: input.llmUsageId,
      status: input.status ?? "sent",
      sentAt: input.sentAt ?? new Date(),
      gmailThreadId: input.gmailThreadId ?? null,
      gmailMessageId: input.gmailMessageId ?? null,
    })
    .returning({
      id: messages.id,
      createdAt: messages.createdAt,
    });

  if (!row) {
    throw new Error("insertMessage: no row returned");
  }
  return row;
}

/**
 * Fetch a single message for the active org. Returns undefined if not found
 * (multi-tenant filter prevents cross-org reads).
 */
export async function getMessageById(orgId: string, messageId: string) {
  return getDb().query.messages.findFirst({
    where: and(
      eq(messages.organizationId, orgId),
      eq(messages.id, messageId),
    ),
  });
}

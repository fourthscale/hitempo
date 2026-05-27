import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
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
  llmUsageId: string;
};

/**
 * Inserts a draft message row. The provenance fields (provider/model/tokens/cost)
 * live in llm_usage and are referenced through llmUsageId.
 */
export async function insertMessage(orgId: string, input: InsertMessageInput) {
  const [row] = await getDb()
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
      status: "draft",
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

export type MessageStatusUpdate = "copied" | "discarded" | "sent";

export async function updateMessageStatus(
  orgId: string,
  messageId: string,
  status: MessageStatusUpdate,
): Promise<void> {
  await getDb()
    .update(messages)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.id, messageId),
      ),
    );
}

export async function updateMessageContent(
  orgId: string,
  messageId: string,
  content: string,
): Promise<void> {
  await getDb()
    .update(messages)
    .set({ content, updatedAt: new Date() })
    .where(
      and(
        eq(messages.organizationId, orgId),
        eq(messages.id, messageId),
      ),
    );
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

import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { messageAttachments } from "@/db/schema";

export type MessageAttachmentRow = Awaited<ReturnType<typeof getAttachmentsByMessage>>[number];

export type InsertMessageAttachmentInput = {
  organizationId: string;
  messageId: string;
  storageBucket: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
};

export async function insertMessageAttachment(input: InsertMessageAttachmentInput) {
  const [row] = await getDb()
    .insert(messageAttachments)
    .values({
      organizationId: input.organizationId,
      messageId: input.messageId,
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  if (!row) throw new Error("insertMessageAttachment: no row returned");
  return row;
}

export async function getAttachmentsByMessage(orgId: string, messageId: string) {
  return getDb()
    .select({
      id: messageAttachments.id,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      sizeBytes: messageAttachments.sizeBytes,
      storageBucket: messageAttachments.storageBucket,
      storagePath: messageAttachments.storagePath,
      uploadedAt: messageAttachments.uploadedAt,
    })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.organizationId, orgId),
        eq(messageAttachments.messageId, messageId),
      ),
    )
    .orderBy(asc(messageAttachments.uploadedAt));
}

/**
 * Bulk-fetch attachments for a set of message ids. Used by surfaces that
 * render the contact / company interaction timeline : we want one query
 * for all messages in the page rather than N queries (one per interaction).
 * Returns a Map keyed by `message_id` for O(1) lookup at render time.
 */
export async function getAttachmentsByMessageIds(
  orgId: string,
  messageIds: string[],
): Promise<Map<string, MessageAttachmentRow[]>> {
  const map = new Map<string, MessageAttachmentRow[]>();
  if (messageIds.length === 0) return map;

  const rows = await getDb()
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      filename: messageAttachments.filename,
      mimeType: messageAttachments.mimeType,
      sizeBytes: messageAttachments.sizeBytes,
      storageBucket: messageAttachments.storageBucket,
      storagePath: messageAttachments.storagePath,
      uploadedAt: messageAttachments.uploadedAt,
    })
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.organizationId, orgId),
        inArray(messageAttachments.messageId, messageIds),
      ),
    )
    .orderBy(asc(messageAttachments.uploadedAt));

  for (const row of rows) {
    const { messageId, ...rest } = row;
    const arr = map.get(messageId) ?? [];
    // We strip messageId from the value (caller already has it as the key).
    arr.push(rest as MessageAttachmentRow);
    map.set(messageId, arr);
  }
  return map;
}

export async function getAttachmentById(orgId: string, attachmentId: string) {
  const [row] = await getDb()
    .select()
    .from(messageAttachments)
    .where(
      and(
        eq(messageAttachments.organizationId, orgId),
        eq(messageAttachments.id, attachmentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteMessageAttachment(orgId: string, attachmentId: string) {
  await getDb()
    .delete(messageAttachments)
    .where(
      and(
        eq(messageAttachments.organizationId, orgId),
        eq(messageAttachments.id, attachmentId),
      ),
    );
}

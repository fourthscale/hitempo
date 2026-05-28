"use server";

import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getAttachmentById } from "@/db/queries/message-attachments";
import { getAttachmentStorageService } from "@/lib/gmail/attachment-storage-service";
import { UserFacingActionError } from "./user-facing-action-error";

/**
 * Generates a fresh signed URL to download an attachment. Called on click
 * from the timeline so the URL doesn't sit in the HTML (it has a short TTL
 * and would expire mid-session).
 *
 * Multi-tenant safe : the query helper filters by `organizationId`, and RLS
 * enforces it server-side too. Cross-org attempts return AttachmentNotFound.
 */

class AttachmentNotFoundError extends UserFacingActionError {
  public readonly code = "ATTACHMENT_NOT_FOUND";
  constructor(public readonly attachmentId: string) {
    super(`Attachment not found: ${attachmentId}`);
  }
}

const schema = z.object({ attachmentId: z.string().uuid() });

export async function getAttachmentDownloadUrlAction(
  input: z.infer<typeof schema>,
): Promise<{ url: string; filename: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AttachmentNotFoundError("invalid_input");
  }
  const { activeOrganization } = await getActiveOrg();
  const row = await getAttachmentById(activeOrganization.id, parsed.data.attachmentId);
  if (!row) throw new AttachmentNotFoundError(parsed.data.attachmentId);

  const url = await getAttachmentStorageService().signedDownloadUrl(
    row.storageBucket,
    row.storagePath,
  );
  return { url, filename: row.filename };
}

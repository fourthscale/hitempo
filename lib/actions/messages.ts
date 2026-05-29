"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getSenderName } from "@/lib/auth/sender-name";
import { logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import { emitSequenceTaskCompleted } from "@/lib/sequences/engine/emit-task-completed";
import { getContactById } from "@/db/queries/contacts";
import { insertMessage } from "@/db/queries/messages";
import { insertMessageAttachment } from "@/db/queries/message-attachments";
import { MessageGenerationOrchestratorFactory } from "@/lib/messages/message-generation-orchestrator-factory";
import { LlmGenerationServiceFactory } from "@/lib/ai/llm-generation-service-factory";
import { GmailServiceFactory } from "@/lib/gmail/gmail-service-factory";
import { GmailCredentialsNotFoundError, GmailApiError } from "@/lib/gmail/gmail-errors";
import { getAttachmentStorageService } from "@/lib/gmail/attachment-storage-service";
import type { MimeAttachment } from "@/lib/gmail/mime-message-strategy";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  isAllowedAttachmentMimeType,
} from "@/lib/gmail/attachment-limits";
import {
  parseChannelIntent,
  messageIntentToInteractionType,
  type MessageChannel,
  type MessageIntent,
  type MessageLocale,
} from "@/lib/messages/types";
import {
  AttachmentRejectedError,
  InvalidInputError,
  MessageActionInteractionInsertFailedError,
  GmailNotConnectedError,
  ContactEmailMissingError,
  GmailSendFailedError,
} from "./message-action-errors";

// ---------------------------------------------------------------------------
// generateMessageAction
// ---------------------------------------------------------------------------

const channelIntentValues = [
  "email-first_contact",
  "email-follow_up",
  "email-meeting_request",
  "email-proposal_send",
  "email-reconnect",
  "linkedin-first_contact",
  "linkedin-follow_up",
  "linkedin-meeting_request",
  "linkedin-reconnect",
] as const;

const generateSchema = z.object({
  contactId: z.string().uuid(),
  companyId: z.string().uuid(),
  taskId: z.string().uuid().optional().or(z.literal("")),
  channelIntent: z.enum(channelIntentValues),
  locale: z.enum(["fr", "en"]),
  includeSignal: z.preprocess(
    (v) => v === "true" || v === true || v === "on" || v === "1",
    z.boolean(),
  ),
  orientation: z.string().max(500).optional().or(z.literal("")),
});

export type GenerateMessageResult = {
  /** Full raw content (with "Subject: ..." line for email). Send via Gmail
   *  / Log interaction will persist this verbatim. */
  content: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  /** Caller passes this back on commit so the new `messages` row can FK to
   *  the already-created `llm_usage` audit row. */
  llmUsageId: string;
  tokensIn: number;
  tokensOut: number;
};

export async function generateMessageAction(
  formData: FormData,
): Promise<GenerateMessageResult> {
  // 1. Validate input.
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const input = parsed.data;
  const { channel, intent } = parseChannelIntent(input.channelIntent);

  // 2. Auth + sender (derived from user metadata).
  const { activeOrganization, user } = await getActiveOrg();
  const sender = getSenderName(user);

  // 3. Delegate the whole pipeline to the orchestrator Facade.
  const orchestrator = MessageGenerationOrchestratorFactory.getInstance();
  const result = await orchestrator.generate({
    organizationId: activeOrganization.id,
    userId: user.id,
    contactId: input.contactId,
    companyId: input.companyId,
    taskId: input.taskId && input.taskId !== "" ? input.taskId : null,
    channel,
    intent,
    locale: input.locale as MessageLocale,
    includeSignal: input.includeSignal,
    orientation:
      input.orientation && input.orientation !== "" ? input.orientation : null,
    sender,
  });

  // 4. Revalidate the surfaces that show messages.
  revalidatePath(`/contacts/${input.contactId}`);
  revalidatePath(`/companies/${input.companyId}`);
  if (input.taskId) revalidatePath("/tasks");

  return result;
}

// ---------------------------------------------------------------------------
// Commit a generated message — shared schema + helper
// ---------------------------------------------------------------------------

/**
 * The dialog holds the AI-generated content client-side and posts it back
 * (along with the contextual metadata captured at generation time) when the
 * user actually acts on it — Send via Gmail or Log interaction. The same
 * shape feeds both commit actions.
 */
const commitSchema = z.object({
  contactId: z.string().uuid(),
  companyId: z.string().uuid(),
  taskId: z.string().uuid().optional().or(z.literal("")),
  channelIntent: z.enum(channelIntentValues),
  locale: z.enum(["fr", "en"]),
  content: z.string().min(1).max(20_000),
  llmUsageId: z.string().uuid(),
  orientation: z.string().max(500).optional().or(z.literal("")),
});

type CommitData = z.infer<typeof commitSchema>;
type ParsedCommit = {
  data: CommitData;
  channel: MessageChannel;
  intent: MessageIntent;
};

function parseCommitFormData(formData: FormData): ParsedCommit {
  // FormData.entries() would include File entries — we only want the scalar
  // commit fields here. The `attachments` field is extracted separately by
  // `parseAttachmentsFromFormData()` for the Gmail send path.
  const scalar: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "attachments") continue;
    if (typeof value === "string") scalar[key] = value;
  }
  const parsed = commitSchema.safeParse(scalar);
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { channel, intent } = parseChannelIntent(parsed.data.channelIntent);
  return { data: parsed.data, channel, intent };
}

/**
 * Reads attached File entries from the dialog's FormData and returns them
 * as MIME-ready `{ filename, mimeType, content }` triples. Enforces the
 * limits from `attachment-limits.ts` defensively — even if the client
 * validates upstream, the server is the authoritative gate.
 *
 * Returns an empty array when no attachments are present (text-only send).
 */
async function parseAttachmentsFromFormData(
  formData: FormData,
): Promise<MimeAttachment[]> {
  const raw = formData.getAll("attachments").filter((v): v is File => v instanceof File);
  if (raw.length === 0) return [];

  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentRejectedError(
      `Too many files (max ${MAX_ATTACHMENTS_PER_MESSAGE})`,
    );
  }

  let totalBytes = 0;
  const result: MimeAttachment[] = [];
  for (const file of raw) {
    if (!isAllowedAttachmentMimeType(file.type)) {
      throw new AttachmentRejectedError(
        `Unsupported file type "${file.type}" — allowed: ${ALLOWED_ATTACHMENT_MIME_TYPES.join(", ")}`,
      );
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new AttachmentRejectedError(
        `"${file.name}" exceeds ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB per-file cap`,
      );
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new AttachmentRejectedError(
        `Combined attachment size exceeds ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024)} MB cap`,
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    result.push({ filename: file.name, mimeType: file.type, content: buf });
  }
  return result;
}

/**
 * Inserts the `messages` row + auto-logs the outbound interaction +
 * completes the originating task (if any). Used by both
 * `sendMessageViaGmailAction` and `logSentInteractionAction`.
 *
 * `gmail` is the Gmail-side metadata (thread id + message id) populated by
 * the Gmail send path ; undefined for the manual-log path.
 *
 * Returns the new message id + interaction id so the caller can hand them
 * back to the UI (router.refresh covers the revalidation).
 */
async function persistSentMessage(args: {
  orgId: string;
  userId: string;
  data: CommitData;
  channel: MessageChannel;
  intent: MessageIntent;
  gmail?: { threadId: string; messageId: string };
  summary: string | null;
  /** Pre-validated, in-memory attachment payloads. Persisted to Supabase
   *  Storage + `message_attachments` AFTER the message row is created,
   *  because the storage path is keyed on `message_id`. Defaults to []. */
  attachments?: MimeAttachment[];
}): Promise<{ messageId: string; interactionId: string; taskCompleted: boolean }> {
  const { orgId, userId, data, channel, intent, gmail, summary, attachments } = args;
  const taskId = data.taskId && data.taskId !== "" ? data.taskId : null;
  const orientation =
    data.orientation && data.orientation !== "" ? data.orientation : null;

  // 1. Persist the message row — sent state from the start, no draft phase.
  const inserted = await insertMessage(orgId, {
    contactId: data.contactId,
    companyId: data.companyId,
    taskId,
    userId,
    channel,
    intent,
    locale: data.locale,
    orientation,
    content: data.content,
    llmUsageId: data.llmUsageId,
    sentAt: new Date(),
    gmailThreadId: gmail?.threadId ?? null,
    gmailMessageId: gmail?.messageId ?? null,
  });

  // 2. Patch the llm_usage backref — best-effort, never blocks the commit.
  try {
    await LlmGenerationServiceFactory.getInstance().linkUsageToEntity(
      data.llmUsageId,
      "message",
      inserted.id,
    );
  } catch (err) {
    console.error("[persistSentMessage] linkUsageToEntity failed (non-fatal)", err);
  }

  // 3. Log the outbound interaction. messageId points back at the freshly
  //    inserted messages row so the reply-polling job can locate this
  //    outbound when a reply arrives (to flip its status to "responded").
  //    outcome stays null on the outbound — the outcome is qualified on
  //    the reply when it comes in (positive / negative / rdv / etc).
  const interaction = await logInteraction(orgId, userId, {
    companyId: data.companyId,
    contactId: data.contactId,
    taskId,
    type: messageIntentToInteractionType(intent),
    channel,
    outcome: null,
    summary,
    occurredAt: new Date(),
    status: "sent",
    messageId: inserted.id,
  });
  if (!interaction) throw new MessageActionInteractionInsertFailedError();

  // 4. Persist attachments (Storage + metadata rows). Done AFTER the message
  //    row exists because the Storage path is keyed on `message_id`. Failures
  //    here are logged but do NOT block — Gmail already sent the message, and
  //    the user can re-upload if needed via a future retry path.
  if (attachments && attachments.length > 0) {
    const storage = getAttachmentStorageService();
    for (const att of attachments) {
      try {
        const uploaded = await storage.upload({
          organizationId: orgId,
          messageId: inserted.id,
          filename: att.filename,
          mimeType: att.mimeType,
          content: att.content,
        });
        await insertMessageAttachment({
          organizationId: orgId,
          messageId: inserted.id,
          storageBucket: uploaded.storageBucket,
          storagePath: uploaded.storagePath,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.content.byteLength,
          uploadedBy: userId,
        });
      } catch (err) {
        console.error("[persistSentMessage] attachment archive failed (non-fatal)", err);
      }
    }
  }

  // 5. Complete the originating task, if any.
  let taskCompleted = false;
  if (taskId) {
    await completeTask(orgId, taskId, userId);
    await emitSequenceTaskCompleted(orgId, taskId);
    taskCompleted = true;
  }

  return { messageId: inserted.id, interactionId: interaction.id, taskCompleted };
}

// ---------------------------------------------------------------------------
// logSentInteractionAction — "I just sent this externally" from the dialog
// ---------------------------------------------------------------------------

export type LogSentInteractionResult = {
  messageId: string;
  interactionId: string;
  taskCompleted: boolean;
};

/**
 * Persists the AI-generated message as `sent` and records the outbound
 * interaction. Used when the user clicks "Mark task done" / "Log interaction"
 * in the dialog — meaning the message was sent via some external channel
 * (LinkedIn, other mail client, etc.) and we just need to close the loop on
 * our side.
 *
 * Side effects :
 *   - Inserts the `messages` row (status=sent).
 *   - Patches the `llm_usage` backref so usage records know which message they
 *     belong to.
 *   - Inserts an `interactions` row (outbound).
 *   - Updates `contacts.lastContactedAt` (via `logInteraction`).
 *   - Completes the originating task, if any.
 */
export async function logSentInteractionAction(
  formData: FormData,
): Promise<LogSentInteractionResult> {
  const { data, channel, intent } = parseCommitFormData(formData);
  const { activeOrganization, user } = await getActiveOrg();

  const { subject, body } = splitSubjectAndBody(data.content, data.locale);
  const summary = subject || body.slice(0, 120).trim() || null;

  const result = await persistSentMessage({
    orgId: activeOrganization.id,
    userId: user.id,
    data,
    channel,
    intent,
    summary,
  });

  revalidatePath(`/contacts/${data.contactId}`);
  revalidatePath(`/companies/${data.companyId}`);
  revalidatePath("/dashboard");
  if (data.taskId) revalidatePath("/tasks");

  return result;
}

// ---------------------------------------------------------------------------
// sendMessageViaGmailAction — one-click Gmail send + auto log + task close
// ---------------------------------------------------------------------------

export type SendMessageViaGmailResult = {
  messageId: string;
  threadId: string;
  gmailMessageId: string;
  interactionId: string;
  taskCompleted: boolean;
  fromAddress: string;
  toAddress: string;
};

/**
 * Send a draft message through the user's connected Gmail, then close the
 * loop : mark the message sent, log an outbound interaction, and (if the
 * message originated from a task) auto-complete that task.
 *
 * Side effects, in order :
 *   1. Gmail API send (raises GmailSendFailedError on non-2xx).
 *   2. messages.status='sent', sentAt=now, gmail_thread_id, gmail_message_id.
 *   3. interactions row (outbound, channel=email).
 *   4. contacts.lastContactedAt update (via logInteraction).
 *   5. tasks.status='completed' for msg.taskId, if set.
 *
 * Failure mode : if step 1 fails, no DB writes happen. If it succeeds but a
 * later step throws, the message is already sent (Gmail can't unsend) — we
 * persist the Gmail ids first so the user can see what was sent, then let
 * the secondary failure bubble up. The polling job (Slice C) will still
 * detect a reply on a partially-logged thread.
 */
export async function sendMessageViaGmailAction(
  formData: FormData,
): Promise<SendMessageViaGmailResult> {
  const { data, channel, intent } = parseCommitFormData(formData);
  // Attachments are extracted+validated separately because they're File
  // entries, not scalars. The function throws AttachmentRejectedError on
  // any limit violation (size, count, mime type).
  const attachments = await parseAttachmentsFromFormData(formData);
  const { activeOrganization, user } = await getActiveOrg();

  const contact = await getContactById(activeOrganization.id, data.contactId);
  if (!contact?.email) throw new ContactEmailMissingError(data.contactId);

  const { subject, body } = splitSubjectAndBody(data.content, data.locale);

  // 1. Gmail send — attachments travel in the multipart MIME built by
  //    GmailService. Failure here means we never persist anything in the
  //    DB and nothing landed in Storage (we only push to Storage after
  //    Gmail confirms).
  let sendResult;
  try {
    sendResult = await GmailServiceFactory.getInstance().send({
      userId: user.id,
      to: contact.email,
      subject: subject || (data.locale === "fr" ? "(sans objet)" : "(no subject)"),
      body,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  } catch (err) {
    if (err instanceof GmailCredentialsNotFoundError) {
      throw new GmailNotConnectedError();
    }
    if (err instanceof GmailApiError) {
      throw new GmailSendFailedError(err.message);
    }
    throw err;
  }

  // 2. Now that Gmail accepted the send, persist the message row + log the
  //    outbound interaction + archive attachments + complete the task (all
  //    inside persistSentMessage).
  const summary = subject || body.slice(0, 120).trim() || null;
  const persisted = await persistSentMessage({
    orgId: activeOrganization.id,
    userId: user.id,
    data,
    channel,
    intent,
    gmail: { threadId: sendResult.threadId, messageId: sendResult.messageId },
    summary,
    attachments,
  });

  revalidatePath(`/contacts/${data.contactId}`);
  revalidatePath(`/companies/${data.companyId}`);
  revalidatePath("/dashboard");
  if (data.taskId) revalidatePath("/tasks");

  return {
    messageId: persisted.messageId,
    threadId: sendResult.threadId,
    gmailMessageId: sendResult.messageId,
    interactionId: persisted.interactionId,
    taskCompleted: persisted.taskCompleted,
    fromAddress: sendResult.fromAddress,
    toAddress: contact.email,
  };
}

/**
 * Splits the AI-generated content into subject + body. Email messages start
 * with `Subject: ` (en) or `Objet: ` (fr), then a blank line, then the body.
 * LinkedIn / non-email messages have no subject line.
 */
function splitSubjectAndBody(
  content: string,
  locale: string,
): { subject: string; body: string } {
  const subjectPrefix = locale === "fr" ? /^Objet:\s*/i : /^Subject:\s*/i;
  const firstLine = content.split("\n", 1)[0] ?? "";
  if (!subjectPrefix.test(firstLine)) {
    return { subject: "", body: content };
  }
  const subject = firstLine.replace(subjectPrefix, "").trim();
  const body = content.slice(firstLine.length).replace(/^\r?\n\r?\n?/, "");
  return { subject, body };
}


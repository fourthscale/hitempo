"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getSenderName } from "@/lib/auth/sender-name";
import { logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import { getContactById } from "@/db/queries/contacts";
import {
  updateMessageStatus,
  updateMessageContent,
  getMessageById,
  markMessageSentViaGmail,
  type MessageStatusUpdate,
} from "@/db/queries/messages";
import { MessageGenerationOrchestratorFactory } from "@/lib/messages/message-generation-orchestrator-factory";
import { GmailServiceFactory } from "@/lib/gmail/gmail-service-factory";
import { GmailCredentialsNotFoundError, GmailApiError } from "@/lib/gmail/gmail-errors";
import {
  parseChannelIntent,
  messageIntentToInteractionType,
  type MessageChannel,
  type MessageIntent,
  type MessageLocale,
} from "@/lib/messages/types";
import {
  InvalidInputError,
  MessageActionInteractionInsertFailedError,
  MessageActionMessageNotFoundError,
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
  messageId: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
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
// updateMessageStatusAction
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  messageId: z.string().uuid(),
  status: z.enum(["copied", "discarded", "sent"]),
});

export async function updateMessageStatusAction(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  await updateMessageStatus(
    activeOrganization.id,
    parsed.data.messageId,
    parsed.data.status as MessageStatusUpdate,
  );

  // Find the message to revalidate the right paths
  const msg = await getMessageById(activeOrganization.id, parsed.data.messageId);
  if (msg) {
    revalidatePath(`/contacts/${msg.contactId}`);
    revalidatePath(`/companies/${msg.companyId}`);
    if (msg.taskId) revalidatePath("/tasks");
  }
}

// ---------------------------------------------------------------------------
// updateMessageContentAction
// ---------------------------------------------------------------------------

const contentSchema = z.object({
  messageId: z.string().uuid(),
  subject: z.string().max(500).optional().or(z.literal("")),
  body: z.string().min(1).max(20_000),
});

// ---------------------------------------------------------------------------
// logSentInteractionAction — one-click "I just sent this" from the dialog
// ---------------------------------------------------------------------------

const logSentSchema = z.object({
  messageId: z.string().uuid(),
});

export type LogSentInteractionResult = {
  interactionId: string;
  taskCompleted: boolean;
};

/**
 * Records an interaction reflecting that the user just sent the generated
 * message externally (Gmail, LinkedIn UI, …). Maps the message metadata to
 * the interaction schema so the user doesn't fill the form manually.
 *
 * When the message was generated from a task (`message.taskId` set), also
 * marks the task as completed — one click closes the loop, no separate
 * "mark as done" step needed.
 *
 * Side effects :
 *   - Inserts an `interactions` row.
 *   - Updates `contacts.lastContactedAt` (via `logInteraction` helper).
 *   - Flips the message status to "sent".
 *   - If message.taskId is set : marks the task `completed`.
 *   - Triggers a score recompute (interaction is a scoring input).
 */
export async function logSentInteractionAction(
  formData: FormData,
): Promise<LogSentInteractionResult> {
  const parsed = logSentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization, user } = await getActiveOrg();
  const msg = await getMessageById(activeOrganization.id, parsed.data.messageId);
  if (!msg) throw new MessageActionMessageNotFoundError(parsed.data.messageId);

  const summary =
    msg.channel === "email" && msg.content.startsWith("Objet:")
      ? msg.content.split("\n", 1)[0]!.replace(/^Objet:\s*/i, "").trim()
      : msg.channel === "email" && msg.content.startsWith("Subject:")
      ? msg.content.split("\n", 1)[0]!.replace(/^Subject:\s*/i, "").trim()
      : msg.content.slice(0, 120).trim();

  const interaction = await logInteraction(activeOrganization.id, user.id, {
    companyId: msg.companyId,
    contactId: msg.contactId,
    taskId: msg.taskId,
    type: messageIntentToInteractionType(msg.intent as MessageIntent),
    channel: msg.channel,
    // Default state for an auto-logged sent message : "sent, awaiting reply".
    // Maps to `no_response` per the CRM convention — the user updates this if
    // a reply actually comes in (positive/negative/rdv_scheduled/etc).
    outcome: "no_response",
    summary: summary || null,
    occurredAt: new Date(),
  });
  if (!interaction) throw new MessageActionInteractionInsertFailedError();

  // Mark the message as sent so the row reflects reality.
  await updateMessageStatus(activeOrganization.id, msg.id, "sent");

  // If the message was generated from a task, the act of sending closes that
  // task — auto-complete it so the user doesn't have to do it in two clicks.
  let taskCompleted = false;
  if (msg.taskId) {
    await completeTask(activeOrganization.id, msg.taskId, user.id);
    taskCompleted = true;
  }

  revalidatePath(`/contacts/${msg.contactId}`);
  revalidatePath(`/companies/${msg.companyId}`);
  revalidatePath("/dashboard");
  if (msg.taskId) revalidatePath("/tasks");

  return { interactionId: interaction.id, taskCompleted };
}

// ---------------------------------------------------------------------------
// sendMessageViaGmailAction — one-click Gmail send + auto log + task close
// ---------------------------------------------------------------------------

const sendViaGmailSchema = z.object({
  messageId: z.string().uuid(),
});

export type SendMessageViaGmailResult = {
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
  const parsed = sendViaGmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization, user } = await getActiveOrg();
  const msg = await getMessageById(activeOrganization.id, parsed.data.messageId);
  if (!msg) throw new MessageActionMessageNotFoundError(parsed.data.messageId);

  const contact = await getContactById(activeOrganization.id, msg.contactId);
  if (!contact?.email) throw new ContactEmailMissingError(msg.contactId);

  // Split "Subject: foo\n\nbody" — the same convention the AI generator emits.
  const { subject, body } = splitSubjectAndBody(msg.content, msg.locale);

  // 1. Gmail send. Any failure here aborts before any DB mutation.
  let result;
  try {
    result = await GmailServiceFactory.getInstance().send({
      userId: user.id,
      to: contact.email,
      subject: subject || (msg.locale === "fr" ? "(sans objet)" : "(no subject)"),
      body,
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

  // 2. Persist Gmail ids on the message row immediately — even if downstream
  //    bookkeeping fails, we never lose the link between our row and the
  //    Gmail thread (needed for reply tracking).
  await markMessageSentViaGmail(activeOrganization.id, msg.id, {
    threadId: result.threadId,
    messageId: result.messageId,
  });

  // 3. Auto-log the outbound interaction.
  const summary = subject || body.slice(0, 120).trim();
  const interaction = await logInteraction(activeOrganization.id, user.id, {
    companyId: msg.companyId,
    contactId: msg.contactId,
    taskId: msg.taskId,
    type: messageIntentToInteractionType(msg.intent as MessageIntent),
    channel: msg.channel,
    outcome: "no_response",
    summary: summary || null,
    occurredAt: new Date(),
  });
  if (!interaction) throw new MessageActionInteractionInsertFailedError();

  // 4. Complete the originating task, if any.
  let taskCompleted = false;
  if (msg.taskId) {
    await completeTask(activeOrganization.id, msg.taskId, user.id);
    taskCompleted = true;
  }

  revalidatePath(`/contacts/${msg.contactId}`);
  revalidatePath(`/companies/${msg.companyId}`);
  revalidatePath("/dashboard");
  if (msg.taskId) revalidatePath("/tasks");

  return {
    threadId: result.threadId,
    gmailMessageId: result.messageId,
    interactionId: interaction.id,
    taskCompleted,
    fromAddress: result.fromAddress,
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

export async function updateMessageContentAction(formData: FormData): Promise<void> {
  const parsed = contentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  const { activeOrganization } = await getActiveOrg();

  const existing = await getMessageById(activeOrganization.id, parsed.data.messageId);
  if (!existing) throw new MessageActionMessageNotFoundError(parsed.data.messageId);

  const reassembled =
    existing.channel === "email" && parsed.data.subject
      ? `${existing.locale === "fr" ? "Objet" : "Subject"}: ${parsed.data.subject.trim()}\n\n${parsed.data.body}`
      : parsed.data.body;

  await updateMessageContent(activeOrganization.id, parsed.data.messageId, reassembled);

  revalidatePath(`/contacts/${existing.contactId}`);
  revalidatePath(`/companies/${existing.companyId}`);
}

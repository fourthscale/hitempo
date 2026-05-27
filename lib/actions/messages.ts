"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getSenderName } from "@/lib/auth/sender-name";
import { logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import {
  updateMessageStatus,
  updateMessageContent,
  getMessageById,
  type MessageStatusUpdate,
} from "@/db/queries/messages";
import { MessageGenerationOrchestratorFactory } from "@/lib/messages/message-generation-orchestrator-factory";
import {
  parseChannelIntent,
  messageIntentToInteractionType,
  type MessageChannel,
  type MessageIntent,
  type MessageLocale,
} from "@/lib/messages/types";

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
  if (!parsed.success) throw new Error("invalid_input");
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
  if (!parsed.success) throw new Error("invalid_input");
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
  if (!parsed.success) throw new Error("invalid_input");

  const { activeOrganization, user } = await getActiveOrg();
  const msg = await getMessageById(activeOrganization.id, parsed.data.messageId);
  if (!msg) throw new Error("message_not_found");

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
  if (!interaction) throw new Error("interaction_insert_failed");

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

export async function updateMessageContentAction(formData: FormData): Promise<void> {
  const parsed = contentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const { activeOrganization } = await getActiveOrg();

  const existing = await getMessageById(activeOrganization.id, parsed.data.messageId);
  if (!existing) throw new Error("message_not_found");

  const reassembled =
    existing.channel === "email" && parsed.data.subject
      ? `${existing.locale === "fr" ? "Objet" : "Subject"}: ${parsed.data.subject.trim()}\n\n${parsed.data.body}`
      : parsed.data.body;

  await updateMessageContent(activeOrganization.id, parsed.data.messageId, reassembled);

  revalidatePath(`/contacts/${existing.contactId}`);
  revalidatePath(`/companies/${existing.companyId}`);
}

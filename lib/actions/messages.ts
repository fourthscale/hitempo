"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveOrg } from "@/lib/auth/context";
import { getSenderName } from "@/lib/auth/sender-name";
import { getBrandBrief } from "@/db/queries/brand";
import { getCompanyById } from "@/db/queries/companies";
import { getContactById } from "@/db/queries/contacts";
import { getRecentInteractionsForPrompt, logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import {
  getRecentMessagesByContact,
  insertMessage,
  updateMessageStatus,
  updateMessageContent,
  getMessageById,
  type MessageStatusUpdate,
} from "@/db/queries/messages";
import { LlmGenerationServiceFactory } from "@/lib/ai/llm-generation-service-factory";
import { buildOutboundMessagePrompt } from "@/lib/ai/prompts/outbound-message-prompt";
import { extractSubjectAndBody } from "@/lib/messages/extract-subject";
import { BrandBriefMissingError } from "@/lib/ai/errors";
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
  // 1. Validate input
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const input = parsed.data;
  const { channel, intent } = parseChannelIntent(input.channelIntent);
  const locale = input.locale as MessageLocale;

  // 2. Auth + sender
  const { activeOrganization, user } = await getActiveOrg();
  const sender = getSenderName(user);

  // 3. Fetch context in parallel
  const [contact, company, brief, interactionsList, previousMsgs] = await Promise.all([
    getContactById(activeOrganization.id, input.contactId),
    getCompanyById(activeOrganization.id, input.companyId),
    getBrandBrief(activeOrganization.id),
    getRecentInteractionsForPrompt(activeOrganization.id, input.companyId),
    getRecentMessagesByContact(activeOrganization.id, input.contactId, 5),
  ]);

  if (!contact) throw new Error("contact_not_found");
  if (!company) throw new Error("company_not_found");

  // 4. Validate brand brief for the target locale
  const briefLocale = brief?.[locale];
  if (!briefLocale || !briefLocale.positioning) {
    throw new BrandBriefMissingError(locale);
  }

  // 5. Build the signal context (or omit if the user toggled it off, OR if
  //    no signal is present on the company in the first place).
  const companySignal =
    input.includeSignal && company.signalType && company.signalDetectedAt
      ? {
          type: company.signalType,
          detectedAt: company.signalDetectedAt,
          ageDays: Math.floor(
            (Date.now() - new Date(company.signalDetectedAt).getTime()) / (24 * 60 * 60 * 1000),
          ),
        }
      : null;

  // 6. Build prompt
  const { systemPrompt, userPrompt } = buildOutboundMessagePrompt({
    brandBrief: briefLocale,
    company: {
      name: company.name,
      industry: company.industry,
      standing: company.standing,
      score: company.score,
    },
    signal: companySignal,
    contact: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      jobTitle: contact.jobTitle,
      preferredLanguage: contact.preferredLanguage ?? locale,
      relevance: contact.relevance,
    },
    interactions: interactionsList.map((i) => ({
      occurredAt: i.occurredAt,
      type: i.type,
      channel: i.channel,
      outcome: i.outcome,
      summary: i.summary,
      interestLevel: i.interestLevel,
    })),
    previousMessages: previousMsgs.map((m) => ({
      createdAt: m.createdAt,
      channel: m.channel as MessageChannel,
      intent: m.intent as MessageIntent,
      content: m.content,
    })),
    sender,
    intent,
    channel,
    locale,
    orientation: input.orientation || undefined,
  });

  // 7. Call the LLM via the Facade (auto-logs to llm_usage)
  const svc = LlmGenerationServiceFactory.getInstance();
  const { result, usage } = await svc.generate({
    input: { systemPrompt, userPrompt },
    context: {
      organizationId: activeOrganization.id,
      userId: user.id,
      type: "outbound_message",
    },
  });

  // 8. Parse subject + body for email ; LinkedIn = body only
  const { subject, body } = extractSubjectAndBody(result.content, channel, locale);

  // 9. Insert the message row, FK to llm_usage
  const inserted = await insertMessage(activeOrganization.id, {
    contactId: input.contactId,
    companyId: input.companyId,
    taskId: input.taskId && input.taskId !== "" ? input.taskId : null,
    userId: user.id,
    channel,
    intent,
    locale,
    orientation: input.orientation && input.orientation !== "" ? input.orientation : null,
    content: result.content,
    llmUsageId: usage.id,
  });

  // 10. Patch the llm_usage backref now that we have the message ID
  await svc.linkUsageToEntity(usage.id, "message", inserted.id);

  // 11. Revalidate the surfaces that show messages
  revalidatePath(`/contacts/${input.contactId}`);
  revalidatePath(`/companies/${input.companyId}`);
  if (input.taskId) revalidatePath("/tasks");

  return {
    messageId: inserted.id,
    channel,
    subject,
    body,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
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

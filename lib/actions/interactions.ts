"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/auth/context";
import { logInteraction, updateInteractionOutcome } from "@/db/queries/interactions";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { InvalidInputError, NotFoundError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

const interactionTypeEnum = z.enum([
  "first_contact", "follow_up", "call", "visit", "linkedin",
  "meeting", "demo", "proposal_sent", "note",
]);
const interactionChannelEnum = z.enum([
  "email", "linkedin", "phone", "in_person", "video", "other",
]);
const interactionOutcomeEnum = z.enum([
  "no_response", "positive_reply", "negative_reply", "out_of_office",
  "wrong_contact", "rdv_scheduled", "opted_out",
]);

const logSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().optional().or(z.literal("")),
  taskId: z.string().uuid().optional().or(z.literal("")),
  type: interactionTypeEnum,
  channel: interactionChannelEnum,
  outcome: interactionOutcomeEnum.optional().or(z.literal("")),
  summary: z.string().max(2000).optional().or(z.literal("")),
  interestLevel: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(0).max(5).nullable().optional(),
  ),
  occurredAt: z.string().min(1),
});

async function _logInteractionAction(formData: FormData) {
  const parsed = logSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization, user } = await getActiveOrg();
  const d = parsed.data;

  await logInteraction(activeOrganization.id, user.id, {
    companyId: d.companyId,
    contactId: d.contactId || null,
    taskId: d.taskId || null,
    type: d.type,
    channel: d.channel,
    outcome: d.outcome || undefined,
    summary: d.summary || null,
    interestLevel: d.interestLevel ?? null,
    occurredAt: new Date(d.occurredAt),
  });

  const contactId = d.contactId || null;
  if (contactId) revalidatePath(`/contacts/${contactId}`);
  revalidatePath(`/companies/${d.companyId}`);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  // Fire-and-forget — don't await so the user response isn't delayed
  void recomputeCompanyScore(activeOrganization.id, d.companyId);
}

/**
 * Updates the outcome of an existing interaction. Used by the contact-detail
 * timeline to flip a `no_response` to `positive_reply` once a reply arrives
 * (or vice-versa). Pass `outcome = ""` to clear the outcome.
 *
 * No score recompute : outcome isn't an input to the scoring formula
 * (interactionCount + lastInteractionAt are — both unchanged by an outcome
 * tweak).
 */
const updateOutcomeSchema = z.object({
  interactionId: z.string().uuid(),
  outcome: interactionOutcomeEnum.or(z.literal("")),
});

async function _updateInteractionOutcomeAction(formData: FormData): Promise<void> {
  const parsed = updateOutcomeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const outcome = parsed.data.outcome === "" ? null : parsed.data.outcome;

  const row = await updateInteractionOutcome(
    activeOrganization.id,
    parsed.data.interactionId,
    outcome,
  );
  if (!row) throw new NotFoundError("interaction", parsed.data.interactionId);

  if (row.contactId) revalidatePath(`/contacts/${row.contactId}`);
  revalidatePath(`/companies/${row.companyId}`);
  if (row.taskId) revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export const logInteractionAction = withActionError(_logInteractionAction);
export const updateInteractionOutcomeAction = withActionError(_updateInteractionOutcomeAction);

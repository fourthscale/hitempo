"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/auth/context";
import { logInteraction, updateInteractionOutcome } from "@/db/queries/interactions";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { promoteContactStatus } from "@/lib/contacts/contact-status-promoter";
import { intentToOutcome, isIntentLabel } from "@/lib/ai/classification/intent-labels";
import { inngest } from "@/lib/inngest/client";
import { EVENT_OUTCOME_QUALIFIED } from "@/lib/sequences/engine/events";
import { InvalidInputError, NotFoundError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

/**
 * Slice D — fire the wake-up event so any sequence enrolment parked on
 * this contact (awaiting reply qualification) advances on the now-set
 * outcome. Safe to call even when no enrolment is parked — the handler
 * is a no-op in that case. Fire-and-forget : if the event bus fails, the
 * cron tick will eventually catch up.
 */
async function emitOutcomeQualified(orgId: string, contactId: string | null) {
  if (!contactId) return;
  try {
    await inngest.send({
      name: EVENT_OUTCOME_QUALIFIED,
      data: { organizationId: orgId, contactId },
    });
  } catch (err) {
    console.error("[interactions/action] outcome.qualified emit failed", err);
  }
}

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

  // Auto-promote contact.status. Manual interaction logs from the UI are
  // always outbound (the sale is recording an action they just took ;
  // inbound replies come in via the Gmail poller, not this code path).
  if (contactId) {
    void promoteContactStatus(activeOrganization.id, contactId, { kind: "outbound_sent" });
  }
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

  // Outcome was set (not cleared) → wake any parked sequence enrolment
  // on this contact so the branch re-evaluates with the qualified fact.
  if (outcome != null) {
    await emitOutcomeQualified(activeOrganization.id, row.contactId);
  }
}

/**
 * Sprint 11.5 / Slice C — confirm the AI's classification on a pending-review
 * row. The label is passed back from the row UI (NOT looked up server-side)
 * so the form posts a coherent confirm-this-exact-label intent ; if the LLM
 * later re-classifies the same row, the action operates on what the user saw.
 *
 * Translation : label → interaction_outcome via `intentToOutcome`. Calling
 * this with a label that has no outcome mapping (neutral / unknown) is a
 * no-op (we never auto-outcome those) ; the UI doesn't surface the button
 * for those, but defending here keeps the action self-consistent.
 */
const confirmAiSchema = z.object({
  interactionId: z.string().uuid(),
  label: z.string().min(1),
});

async function _confirmAiClassificationAction(formData: FormData): Promise<void> {
  const parsed = confirmAiSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);
  if (!isIntentLabel(parsed.data.label)) {
    throw new InvalidInputError();
  }

  const outcome = intentToOutcome(parsed.data.label);
  if (!outcome) {
    // Nothing actionable to do — the UI shouldn't have surfaced "Confirmer"
    // for neutral/unknown. Treat as a noop rather than failing loudly.
    return;
  }

  const { activeOrganization } = await getActiveOrg();
  const row = await updateInteractionOutcome(
    activeOrganization.id,
    parsed.data.interactionId,
    outcome,
  );
  if (!row) throw new NotFoundError("interaction", parsed.data.interactionId);

  if (row.contactId) revalidatePath(`/contacts/${row.contactId}`);
  revalidatePath(`/companies/${row.companyId}`);
  revalidatePath("/inbox/pending-review");
  revalidatePath("/dashboard");

  // The sale just qualified an inbound reply → wake any parked enrolment.
  await emitOutcomeQualified(activeOrganization.id, row.contactId);
}

export const logInteractionAction = withActionError(_logInteractionAction);
export const updateInteractionOutcomeAction = withActionError(_updateInteractionOutcomeAction);
export const confirmAiClassificationAction = withActionError(_confirmAiClassificationAction);

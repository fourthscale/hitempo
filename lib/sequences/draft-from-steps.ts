import type { SequenceStepRow } from "@/db/queries/sequences";
import type { DraftDefinition, DraftStep } from "./draft-schema";

/**
 * Seed an editor draft from the published `sequence_steps`. Used when opening
 * the editor on a sequence that has no pending draft : we reconstruct a draft
 * from the live definition so the user edits a copy, never the live rows.
 *
 * Entry = the step with the lowest `step_order` (Phase A convention). Returns
 * a minimal valid draft (one placeholder step) when the sequence has none yet,
 * so the editor always has something to render.
 */
export function publishedStepsToDraft(steps: SequenceStepRow[]): DraftDefinition {
  if (steps.length === 0) {
    const id = "step-1";
    return {
      entryStepId: id,
      steps: [
        {
          id,
          stepOrder: 0,
          actionType: "send_email",
          actionConfig: {
            mode: "ai",
            channel: "email",
            intent: "first_contact",
            titleTemplate: { fr: "", en: "" },
          },
          nextStepIds: null,
          condition: null,
          filter: null,
        },
      ],
    };
  }

  const sorted = steps.slice().sort((a, b) => a.stepOrder - b.stepOrder);
  const entry = sorted[0]!;
  const draftSteps: DraftStep[] = sorted.map((s) => ({
    id: s.id,
    stepOrder: s.stepOrder,
    actionType: s.actionType,
    actionConfig: (s.actionConfig ?? {}) as DraftStep["actionConfig"],
    nextStepIds: s.nextStepIds,
    condition: s.condition,
    filter: s.filter,
  }));

  return { entryStepId: entry.id, steps: draftSteps };
}

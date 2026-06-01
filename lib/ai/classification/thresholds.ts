/**
 * Confidence-based gating for what we do with a classification result.
 *
 *   - >= AUTO_APPLY_THRESHOLD  → set the interaction.outcome automatically.
 *   - >= REVIEW_THRESHOLD      → store the label, flag for human review,
 *                                do NOT touch outcome.
 *   - <  REVIEW_THRESHOLD      → store nothing actionable ; the row is
 *                                marked processed but treated as "unknown".
 *
 * Numbers are intentionally separated from any sequence behaviour : Slice C
 * will introduce the per-sequence `unknownOutcomeStrategy` knob that decides
 * whether to park or continue when outcome stays null. This module only
 * answers the prior question : "is the classifier confident enough?".
 */
export const AUTO_APPLY_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;

export type ConfidenceTier = "auto" | "review" | "low";

export function tierForConfidence(confidence: number): ConfidenceTier {
  if (confidence >= AUTO_APPLY_THRESHOLD) return "auto";
  if (confidence >= REVIEW_THRESHOLD) return "review";
  return "low";
}

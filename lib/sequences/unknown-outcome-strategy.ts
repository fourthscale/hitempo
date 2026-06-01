/**
 * Sprint 11.5 / Slice D — pure helpers for "what to do when the engine
 * reaches a reply-outcome-dependent branch but the latest inbound reply
 * is still un-qualified (no outcome set)".
 *
 * Kept side-effect-free so the engine integration is mechanical and the
 * branching policy is unit-testable without any DB or LLM fixture.
 *
 *   - SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES : the SoT for valid values,
 *     mirrored by a Postgres CHECK constraint on both `sequences` and
 *     `sequence_steps`.
 *   - resolveUnknownOutcomeStrategy()    : step-override wins, sequence
 *     fallback otherwise, hard-default `park`.
 *   - conditionDependsOnReplyOutcome()   : tree walker for a composite
 *     condition group ; true iff any leaf reads `behavior.positiveReply` or
 *     `behavior.negativeReply` (the two dimensions that NEED a qualified
 *     reply outcome to decide).
 *   - hasUnqualifiedInboundReply()       : did the engine see an inbound
 *     reply with `outcome == null` in the current step window?
 */

import type { ConditionGroup, Condition } from "./conditions";

export const SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES = [
  "park",
  "continue_default",
] as const;
export type SequenceUnknownOutcomeStrategy =
  (typeof SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES)[number];

export function isSequenceUnknownOutcomeStrategy(
  v: unknown,
): v is SequenceUnknownOutcomeStrategy {
  return (
    typeof v === "string" &&
    (SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES as readonly string[]).includes(v)
  );
}

/**
 * Resolve the effective strategy : step-level override wins, otherwise
 * sequence-level, otherwise hard-default `park`. Unknown / invalid values
 * fall through to `park` defensively — we never want a malformed config
 * to trigger an unintended "continue".
 */
export function resolveUnknownOutcomeStrategy(input: {
  sequence: string | null | undefined;
  step: string | null | undefined;
}): SequenceUnknownOutcomeStrategy {
  if (isSequenceUnknownOutcomeStrategy(input.step)) return input.step;
  if (isSequenceUnknownOutcomeStrategy(input.sequence)) return input.sequence;
  return "park";
}

/**
 * Reply-outcome-dependent dimensions. `behavior.replied` alone is NOT
 * outcome-dependent (it only checks presence, not classification) ;
 * positive/negative ARE.
 */
const OUTCOME_DEPENDENT_DIMENSIONS = new Set([
  "behavior.positiveReply",
  "behavior.negativeReply",
]);

export function conditionDependsOnReplyOutcome(
  cond: ConditionGroup | Condition | null | undefined,
): boolean {
  if (!cond) return false;
  if (cond.kind === "leaf") return OUTCOME_DEPENDENT_DIMENSIONS.has(cond.dimension);
  return cond.conditions.some((c) => conditionDependsOnReplyOutcome(c));
}

export type InteractionForOutcomeCheck = {
  type: string;
  outcome: string | null;
};

export function hasUnqualifiedInboundReply(
  interactions: readonly InteractionForOutcomeCheck[],
): boolean {
  return interactions.some(
    (i) => i.type === "email_received" && i.outcome == null,
  );
}

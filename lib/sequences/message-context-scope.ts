/**
 * Sprint 12 — Pure helpers for "what slice of interaction history the AI
 * message generator should see".
 *
 *   - SEQUENCE_MESSAGE_CONTEXT_SCOPES : SoT for valid values, mirrored
 *     by the Postgres CHECK constraint on both `sequences` and
 *     `sequence_steps`.
 *   - resolveMessageContextScope() : step-override wins, sequence
 *     fallback otherwise, hard-default `sequence`. Matches the same
 *     resolution order as `resolveUnknownOutcomeStrategy`.
 *
 * The dialog at generation time can also pass an explicit override that
 * takes precedence over the resolved default — see
 * `resolveMessageContextScopeWithUserOverride`.
 */

export const SEQUENCE_MESSAGE_CONTEXT_SCOPES = ["sequence", "all"] as const;
export type SequenceMessageContextScope =
  (typeof SEQUENCE_MESSAGE_CONTEXT_SCOPES)[number];

export function isSequenceMessageContextScope(
  v: unknown,
): v is SequenceMessageContextScope {
  return (
    typeof v === "string" &&
    (SEQUENCE_MESSAGE_CONTEXT_SCOPES as readonly string[]).includes(v)
  );
}

/**
 * Step override wins, otherwise sequence-level, otherwise hard-default
 * `sequence`. Invalid values fall through to the default defensively —
 * never want a malformed config to silently broaden the prompt context.
 */
export function resolveMessageContextScope(input: {
  sequence: string | null | undefined;
  step: string | null | undefined;
}): SequenceMessageContextScope {
  if (isSequenceMessageContextScope(input.step)) return input.step;
  if (isSequenceMessageContextScope(input.sequence)) return input.sequence;
  return "sequence";
}

/**
 * Same as `resolveMessageContextScope` but adds an extra "user just
 * picked this in the dialog" override layer that wins over everything
 * else. Used by `generateMessageAction` when the sale flips the toggle
 * in the GenerateMessageDialog for THIS message.
 */
export function resolveMessageContextScopeWithUserOverride(input: {
  sequence: string | null | undefined;
  step: string | null | undefined;
  user: string | null | undefined;
}): SequenceMessageContextScope {
  if (isSequenceMessageContextScope(input.user)) return input.user;
  return resolveMessageContextScope(input);
}

export function coerceMessageContextScope(
  raw: string | null | undefined,
): SequenceMessageContextScope {
  return isSequenceMessageContextScope(raw) ? raw : "sequence";
}

/**
 * Classification labels the LLM is allowed to return for an inbound reply.
 *
 * Kept narrow and behavioral (what the sender *intends*), not subjective
 * ("hot/cold"). The classifier MUST return one of these strings (the
 * prompt enforces this) ; the application layer revalidates the label
 * before persisting via `isIntentLabel()`.
 *
 * If the LLM ever invents a new label, we keep it raw on the row (the DB
 * column is plain `text` — see migration) but won't apply any auto side
 * effect — that's the forward-compat guarantee.
 */
export const INTENT_LABELS = [
  /** Clear interest : asks a question, requests info, books a meeting. */
  "positive",
  /** Explicit refusal, not interested. */
  "negative",
  /** Auto-reply : OOO, parental leave, vacation. */
  "out_of_office",
  /** "Wrong person — talk to X" / "not me" replies. */
  "wrong_person",
  /** Unsubscribe / remove-from-list / opt-out request. */
  "unsubscribe",
  /** Neutral acknowledgment, neither yes nor no. Often "thanks, will check". */
  "neutral",
  /** LLM couldn't decide — used when reasoning is ambiguous. */
  "unknown",
] as const;

export type IntentLabel = (typeof INTENT_LABELS)[number];

export function isIntentLabel(value: unknown): value is IntentLabel {
  return typeof value === "string" && (INTENT_LABELS as readonly string[]).includes(value);
}

/**
 * The narrow subset of `interaction_outcome` enum values an intent can map
 * to. Kept as a literal union so TS rejects typos and the consuming DB
 * helper accepts the value without a cast. Must stay in sync with the
 * `interactionOutcome` pgEnum in `db/schema.ts`.
 */
export type IntentOutcome =
  | "positive_reply"
  | "negative_reply"
  | "out_of_office"
  | "wrong_contact"
  | "opted_out";

/**
 * Map a classified intent to the matching `interaction_outcome` enum value
 * for auto-application. `null` = no opinion (the sale qualifies manually).
 *
 * `neutral` and `unknown` deliberately return null : we never overwrite a
 * sale's qualification on weak signal. Same for `negative` until we add
 * the `negative_reply` outcome wiring policy (Slice C handles park behavior).
 */
const INTENT_TO_OUTCOME: Readonly<Record<IntentLabel, IntentOutcome | null>> = {
  positive: "positive_reply",
  negative: "negative_reply",
  out_of_office: "out_of_office",
  wrong_person: "wrong_contact",
  unsubscribe: "opted_out",
  neutral: null,
  unknown: null,
};

export function intentToOutcome(label: IntentLabel): IntentOutcome | null {
  return INTENT_TO_OUTCOME[label];
}

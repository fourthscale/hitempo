/**
 * Single source of truth for `contact.status`. The column is just `text` in
 * Postgres (no enum at the DB level — that's deliberate, see the migration
 * note in db/schema.ts), so this file is what every form / select / filter /
 * Zod schema / CSV importer must import from.
 *
 * ## Semantic levels (low → high)
 *
 *   to_contact      Initial state. The contact exists in the CRM but no
 *                   outreach has been attempted yet.
 *   to_follow_up    Manual : the sale flagged this contact for a follow-up
 *                   later (after a meeting, after a signal, etc.). Halts
 *                   auto-promotion — once the sale has classified the
 *                   contact intent manually, the auto-promoter respects it.
 *   contacted       Auto : at least one outbound interaction has been
 *                   recorded (email sent, call placed, …). Set by the
 *                   evaluator when a `sent` outbound interaction shows up
 *                   on a `to_contact` contact.
 *   replied         Auto : the contact has answered at least once. Set by
 *                   the evaluator when an inbound interaction shows up on
 *                   a `contacted` contact. Doesn't qualify the reply tone
 *                   — that's the per-interaction `outcome` column (and a
 *                   future LLM classifier feeds it).
 *   qualified       Manual : the sale judges this contact a fit for the
 *                   pitch. Subjective, can't be auto-derived. Once set,
 *                   the evaluator respects it (no demotion).
 *   not_interested  Manual : the contact pushed back. Terminal-ish.
 *                   `opted_out` is a stricter, hard-block variant on the
 *                   contact row itself (separate boolean) — `not_interested`
 *                   is "for now, on this pitch".
 *
 * Auto-promotion rules :
 *   - Only PROMOTE (low → high). Never demote.
 *   - Only act when current status is `to_contact` or `contacted`. The
 *     other four are either "sale spoke up" (to_follow_up, qualified,
 *     not_interested) or already at the auto-ceiling (replied).
 */

export const CONTACT_STATUSES = [
  "to_contact",
  "to_follow_up",
  "contacted",
  "replied",
  "qualified",
  "not_interested",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** Statuses the auto-promoter is allowed to transition AWAY from. */
const AUTO_PROMOTABLE_FROM: ReadonlySet<ContactStatus> = new Set([
  "to_contact",
  "contacted",
]);

export type InteractionEvent =
  | { kind: "outbound_sent" }
  | { kind: "inbound_received" };

/**
 * Decide the next `contact.status` given the current value and an event that
 * just occurred. Returns `null` when no transition applies — the caller skips
 * the DB write.
 *
 * Pure function : easy to test, no DB read. The caller is responsible for
 * loading the current status and persisting the result.
 */
export function evaluateNextContactStatus(
  current: ContactStatus | string,
  event: InteractionEvent,
): ContactStatus | null {
  if (!AUTO_PROMOTABLE_FROM.has(current as ContactStatus)) return null;
  if (event.kind === "outbound_sent" && current === "to_contact") return "contacted";
  if (event.kind === "inbound_received" && current === "contacted") return "replied";
  // `to_contact` + inbound : skip-ahead (rare but possible if a contact
  // replies before any outbound was logged). Match the natural ordering :
  // jump straight to `replied` since the contacted state is implied.
  if (event.kind === "inbound_received" && current === "to_contact") return "replied";
  return null;
}

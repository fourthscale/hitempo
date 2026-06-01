import "server-only";
import { getContactStatus, setContactStatus } from "@/db/queries/contacts";
import {
  evaluateNextContactStatus,
  type InteractionEvent,
} from "./contact-status";

/**
 * Thin orchestrator around `evaluateNextContactStatus` :
 *   load current status → evaluate → write only if changed.
 *
 * Every server action that records a new fact about a contact (outbound
 * interaction logged, inbound reply detected, task marked done on a
 * communication channel) calls this. The evaluator is pure ; the DB I/O
 * lives here so the hot path stays a single function call.
 *
 * Idempotent : calling it twice with the same event leaves the second call
 * a no-op (the evaluator returns `null` when the status is already at the
 * target). Safe to `void` from action sites — failures here must never
 * block the user-facing action.
 */
export async function promoteContactStatus(
  orgId: string,
  contactId: string,
  event: InteractionEvent,
): Promise<void> {
  try {
    const current = await getContactStatus(orgId, contactId);
    if (current == null) return;
    const next = evaluateNextContactStatus(current, event);
    if (!next || next === current) return;
    await setContactStatus(orgId, contactId, next);
  } catch {
    // Swallow : this is a side-effect of the primary action (interaction or
    // task write). A failure here mustn't propagate to the user — the next
    // matching event will retry the promotion.
  }
}

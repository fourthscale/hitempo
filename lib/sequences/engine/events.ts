/**
 * Sequence engine Inngest event names. Kept in lib (not the function file) so
 * emitters (server actions) can import them without pulling the function
 * definitions + admin engine factory.
 */
export const EVENT_ADVANCE = "sequences/advance" as const;
export const EVENT_TASK_COMPLETED = "sequences/task.completed" as const;
/**
 * Slice D — emitted when an interaction's `outcome` flips from null to
 * a concrete value (LLM auto-apply ≥ threshold, sale confirms in the
 * inbox, or the existing updateInteractionOutcomeAction). Listeners
 * resume any active enrolment on the same contact that was parked
 * waiting for that qualification.
 */
export const EVENT_OUTCOME_QUALIFIED = "sequences/outcome.qualified" as const;

export type SequenceAdvanceEventData = { enrolmentId: string };
export type SequenceTaskCompletedEventData = { enrolmentId: string };
export type SequenceOutcomeQualifiedEventData = {
  organizationId: string;
  contactId: string;
};

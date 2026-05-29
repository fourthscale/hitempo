/**
 * Sequence engine Inngest event names. Kept in lib (not the function file) so
 * emitters (server actions) can import them without pulling the function
 * definitions + admin engine factory.
 */
export const EVENT_ADVANCE = "sequences/advance" as const;
export const EVENT_TASK_COMPLETED = "sequences/task.completed" as const;

export type SequenceAdvanceEventData = { enrolmentId: string };
export type SequenceTaskCompletedEventData = { enrolmentId: string };

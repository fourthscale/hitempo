/**
 * Sprint 11.5 — pure resolver for "what step is the user looking at?".
 *
 * The engine cursor (`enrolment.currentStepId/Order`) is what the runtime
 * sees ; the USER sees the step they're still working on. They diverge in
 * two cases :
 *
 *   1. Human-action step (send_email / phone_call) created a task and the
 *      task isn't `completed` yet → engine has advanced to the next step
 *      but the user perceives the previous step as "still in progress"
 *      ("waiting on the task").
 *
 *   2. A `wait_delay` step is executed and the countdown is now ticking
 *      against the NEXT step's `next_due_at` → engine cursor is on the
 *      next step but the user perceives the wait as "in progress".
 *
 * `resolveDisplayStepOrder` returns the order the UI should display. Call
 * with whatever info you have ; missing `lastExecution` just falls back
 * to the engine cursor (safe default).
 *
 * Centralised so every surface (enrolment detail page, contact section,
 * tasks list, task detail, future kanban) shows the same number for the
 * same row.
 */

export type DisplayStepInput = {
  status: string;
  currentStepOrder: number;
  nextDueAt: Date | null;
  /**
   * Last `outcome === "executed"` step execution (or null if none yet).
   * Pass `taskCompleted` to indicate the task it spawned is fully done
   * (or it didn't spawn a task at all).
   */
  lastExecution: {
    stepOrder: number;
    actionType: string;
    taskCompleted: boolean;
  } | null;
  /** Defaults to new Date(). Pass for deterministic tests. */
  now?: Date;
};

export function resolveDisplayStepOrder(input: DisplayStepInput): number {
  const { status, currentStepOrder, nextDueAt, lastExecution } = input;
  const now = input.now ?? new Date();

  if (status !== "active" && status !== "paused") return currentStepOrder;
  if (!lastExecution) return currentStepOrder;

  // Case 2 : wait_delay is the last exec AND its `next_due_at` hasn't elapsed
  // yet → the wait itself is what's "in progress" for the user.
  const waitInProgress =
    lastExecution.actionType === "wait_delay" &&
    nextDueAt != null &&
    nextDueAt.getTime() > now.getTime();
  if (waitInProgress) return lastExecution.stepOrder;

  // Case 1 : the last exec spawned a task that isn't done → that step is
  // still the one the user is looking at.
  const waitingForTask = !lastExecution.taskCompleted;
  if (waitingForTask) return lastExecution.stepOrder;

  // Otherwise the engine cursor IS the user's perception.
  return currentStepOrder;
}

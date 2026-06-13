import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { inngest } from "@/lib/inngest/client";
import { EVENT_TASK_AUTO_EXECUTE } from "@/lib/sequences/engine/events";

/**
 * Sprint 14 — bulk re-arm + replay every agent task for `userId` that
 * died with `auto_execution_failure_kind = 'gmail_auth'`.
 *
 * Called from the Gmail OAuth callback right after a successful reconnect.
 * The flow :
 *
 *   1. Atomically reset all matching tasks to `auto_execution_status =
 *      'pending'`, clear the error + failure_kind. Filter on `status =
 *      'pending'` so we don't touch tasks the human has already taken
 *      over and completed by hand. Returns the list of (id, scheduledFor,
 *      organizationId) so step 2 can emit one event per task.
 *
 *   2. Re-emit `sequences/task.auto-execute` for each, honouring the
 *      original `auto_execution_at` (the handler does its own
 *      sleepUntil ; we forward the timestamp verbatim so windowed
 *      scheduling still applies).
 *
 *   3. Return a count to the caller, who flashes it to the user
 *      ("X tâches relancées").
 *
 * The executor itself re-checks status under its own load (see
 * agent-message-executor.ts), so a race with a stale in-flight retry
 * cannot double-send.
 *
 * Errors during step 2 are swallowed per-task (and logged) — partial
 * success is better than failing the whole reconnect flow.
 */
export async function replayGmailAuthFailedTasksForUser(
  organizationId: string,
  userId: string,
): Promise<number> {
  const updated = await getDb()
    .update(tasks)
    .set({
      autoExecutionStatus: "pending",
      autoExecutionError: null,
      autoExecutionFailureKind: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        eq(tasks.assigneeId, userId),
        eq(tasks.status, "pending"),
        eq(tasks.autoExecutionStatus, "failed"),
        eq(tasks.autoExecutionFailureKind, "gmail_auth"),
        // Guard against orphan rows from before the failure_kind column
        // shipped : without `isNotNull`, the next .where matches NULL via
        // the eq check but we want exact-kind match.
        isNotNull(tasks.autoExecutionFailureKind),
      ),
    )
    .returning({
      id: tasks.id,
      autoExecutionAt: tasks.autoExecutionAt,
    });

  if (updated.length === 0) return 0;

  await Promise.allSettled(
    updated.map((row) =>
      inngest.send({
        name: EVENT_TASK_AUTO_EXECUTE,
        data: {
          organizationId,
          taskId: row.id,
          scheduledFor: row.autoExecutionAt
            ? row.autoExecutionAt.toISOString()
            : null,
        },
      }),
    ),
  ).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") {
        console.error(
          "[replayGmailAuthFailedTasksForUser] inngest send rejected (non-fatal)",
          r.reason,
        );
      }
    }
  });

  return updated.length;
}

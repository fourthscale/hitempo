import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { inngest } from "@/lib/inngest/client";
import { EVENT_TASK_COMPLETED } from "./events";

/**
 * If the just-completed task belongs to a sequence enrolment, emit the
 * `sequences/task.completed` event so the engine advances that enrolment
 * immediately (instead of waiting for the next cron tick). Best-effort : a
 * send failure must never block the task action, so callers `void` it.
 */
export async function emitSequenceTaskCompleted(orgId: string, taskId: string): Promise<void> {
  try {
    const row = await getDb().query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)),
      columns: { sequenceEnrolmentId: true },
    });
    if (row?.sequenceEnrolmentId) {
      await inngest.send({
        name: EVENT_TASK_COMPLETED,
        data: { enrolmentId: row.sequenceEnrolmentId },
      });
    }
  } catch {
    // swallow — advancing on next tick is an acceptable fallback.
  }
}

import { inngest } from "@/lib/inngest/client";
import { EVENT_TASK_AUTO_EXECUTE } from "@/lib/sequences/engine/events";
import { AgentMessageExecutorFactory } from "@/lib/sequences/agents/agent-message-executor-factory";

/**
 * Sprint 12 phase 4 — agent auto-execution function.
 *
 * Fires on `sequences/task.auto-execute` (emitted by the sequence engine
 * after creating a task whose source step's `assignment.actor === "agent"`).
 * Flow :
 *
 *   1. `step.sleepUntil(scheduledFor)` so the step's scheduling config
 *      (heures ouvrées, anti-conflit) is honored. When `scheduledFor` is
 *      in the past or null, the sleep no-ops immediately.
 *   2. `step.run("execute")` calls `AgentMessageExecutor.execute({taskId})`.
 *      The executor is idempotent : it re-loads the task, checks
 *      `auto_execution_status === "pending"` + `status === "pending"`,
 *      and aborts if a human already took over.
 *
 * Failure mode : the executor catches its own errors and writes
 * `auto_execution_status = "failed"` + the reason. The Inngest step
 * therefore always succeeds — we don't want Inngest's retry machinery
 * to fire Gmail twice. (A genuine infra crash before the executor
 * runs would still retry the step ; the idempotence check in step 2
 * catches that.)
 *
 * Concurrency cap : one in-flight run per task. A pathological double
 * emit can't race the executor.
 */
async function handleAutoExecute({
  event,
  step,
}: {
  event: {
    data: { organizationId: string; taskId: string; scheduledFor: string | null };
  };
  step: import("inngest").GetStepTools<typeof inngest>;
}) {
  const { taskId, scheduledFor } = event.data;

  if (scheduledFor) {
    const target = new Date(scheduledFor);
    // sleepUntil is a no-op for past dates ; this lets the same code path
    // handle "execute right now" (null) and "wait until 9am" cleanly.
    if (Number.isFinite(target.getTime()) && target.getTime() > Date.now()) {
      await step.sleepUntil("await-scheduled-for", target);
    }
  }

  const result = await step.run("execute", async () => {
    return AgentMessageExecutorFactory.getInstance().execute({ taskId });
  });
  return result;
}

const taskAutoExecute = inngest.createFunction(
  {
    id: "sequences/task-auto-execute",
    name: "Sequence — agent auto-execute task",
    concurrency: { key: "event.data.taskId", limit: 1 },
    triggers: [{ event: EVENT_TASK_AUTO_EXECUTE }],
  },
  handleAutoExecute,
);

export const agentAutoExecuteFunctions = [taskAutoExecute];

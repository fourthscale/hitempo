import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { sequenceStepExecutions } from "@/db/schema";
import type { SequenceStepActionType } from "@/lib/sequences/types";

/**
 * Query helpers for `sequence_step_executions` — the per-step audit + the
 * idempotence backbone. The (`enrolment_id`, `execution_counter`) UNIQUE means
 * a retried engine tick that re-inserts the same counter fails loudly instead
 * of double-executing.
 */

export type StepExecutionOutcome = "executed" | "skipped_filter" | "skipped_condition";

export type InsertStepExecutionInput = {
  enrolmentId: string;
  stepId: string;
  stepOrder: number;
  actionType: SequenceStepActionType;
  executionCounter: number;
  outcome: StepExecutionOutcome;
  taskId?: string | null;
  notes?: string | null;
  executedAt?: Date;
};

/**
 * Insert an execution row. Throws on a duplicate (enrolmentId, executionCounter)
 * — the caller (engine) treats that as "already processed, skip".
 */
export async function insertStepExecution(db: DbOrTx, input: InsertStepExecutionInput) {
  const [row] = await db
    .insert(sequenceStepExecutions)
    .values({
      enrolmentId: input.enrolmentId,
      stepId: input.stepId,
      stepOrder: input.stepOrder,
      actionType: input.actionType,
      executionCounter: input.executionCounter,
      outcome: input.outcome,
      taskId: input.taskId ?? null,
      notes: input.notes ?? null,
      executedAt: input.executedAt ?? new Date(),
    })
    .returning({ id: sequenceStepExecutions.id });
  if (!row) throw new Error("insertStepExecution: no row returned");
  return row;
}

/** Full execution trail for an enrolment, oldest first (timeline display). */
export async function listExecutionsForEnrolment(db: DbOrTx, enrolmentId: string) {
  return db
    .select({
      id: sequenceStepExecutions.id,
      stepId: sequenceStepExecutions.stepId,
      stepOrder: sequenceStepExecutions.stepOrder,
      actionType: sequenceStepExecutions.actionType,
      executionCounter: sequenceStepExecutions.executionCounter,
      outcome: sequenceStepExecutions.outcome,
      taskId: sequenceStepExecutions.taskId,
      notes: sequenceStepExecutions.notes,
      executedAt: sequenceStepExecutions.executedAt,
    })
    .from(sequenceStepExecutions)
    .where(eq(sequenceStepExecutions.enrolmentId, enrolmentId))
    .orderBy(asc(sequenceStepExecutions.executionCounter));
}

/** True if a given execution counter was already recorded (pre-check). */
export async function executionCounterExists(db: DbOrTx, enrolmentId: string, counter: number) {
  const row = await db.query.sequenceStepExecutions.findFirst({
    where: and(
      eq(sequenceStepExecutions.enrolmentId, enrolmentId),
      eq(sequenceStepExecutions.executionCounter, counter),
    ),
    columns: { id: true },
  });
  return row != null;
}

/** True if a given (enrolment, step) pair already has an executed row. Used
 *  by the engine to detect terminal-step re-entry : when the engine parks on
 *  a terminal step awaiting its human task to close, the next
 *  `sequences/task.completed` event re-enters here ; this guard tells us
 *  "the step has already run, end the enrolment now". */
export async function stepHasExecutedRow(
  db: DbOrTx,
  enrolmentId: string,
  stepId: string,
): Promise<boolean> {
  const row = await db.query.sequenceStepExecutions.findFirst({
    where: and(
      eq(sequenceStepExecutions.enrolmentId, enrolmentId),
      eq(sequenceStepExecutions.stepId, stepId),
      eq(sequenceStepExecutions.outcome, "executed"),
    ),
    columns: { id: true },
  });
  return row != null;
}

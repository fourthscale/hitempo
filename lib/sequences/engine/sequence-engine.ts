import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sequences as sequencesTable } from "@/db/schema";
import { getStepsForSequence, type SequenceStepRow } from "@/db/queries/sequences";
import {
  getDueEnrolments,
  advanceEnrolment,
  endEnrolment,
  parkEnrolmentAwaitingOutcome,
} from "@/db/queries/sequence-enrolments";
import {
  getEnrolmentForEngine,
  getEnrolmentEntityContext,
  getInteractionsSince,
} from "@/db/queries/sequence-engine";
import {
  insertStepExecution,
  executionCounterExists,
  stepHasExecutedRow,
} from "@/db/queries/sequence-executions";
import { SequencePredicateEvaluatorFactory } from "../predicates/predicate-evaluator-factory";
import { SequenceStepExecutorFactory } from "../step-executor-factory";
import {
  conditionDependsOnReplyOutcome,
  hasUnqualifiedInboundReply,
  resolveUnknownOutcomeStrategy,
} from "../unknown-outcome-strategy";
import type { ConditionGroup } from "../conditions";
import type { SequenceExecutorServices, StepExecutionContext } from "../step-executor";
import type {
  NextStepIds,
  SequenceEnrolmentCtx,
  SequenceStepCtx,
  SequenceEndReason,
} from "../types";

export type AdvanceOutcome =
  | { status: "skipped"; reason: string }
  | { status: "executed"; taskId: string | null; navigatedTo: string | null }
  | { status: "parked"; reason: "awaiting_outcome" }
  | { status: "ended"; reason: SequenceEndReason };

/**
 * The sequence runtime. One public method, `advanceEnrolment`, runs exactly one
 * step for one enrolment (the per-enrolment Inngest handler calls it). It is
 * idempotent on `(enrolment_id, execution_counter)` so an Inngest retry cannot
 * double-execute a step.
 *
 * Admin-pool + injected clock (constructor). The engine NEVER reads
 * `draft_definition` — only the published `sequence_steps`. After a publish
 * swap regenerates step ids, the engine resolves the live step from
 * `current_step_id` with a fallback to `current_step_order`, ending overshoot
 * enrolments as `completed_exhausted`.
 */
export class SequenceEngine {
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly services: SequenceExecutorServices;

  constructor(deps: { db: Db; services: SequenceExecutorServices; now?: () => Date }) {
    this.db = deps.db;
    this.services = deps.services;
    this.now = deps.now ?? (() => new Date());
  }

  /** Enrolment ids whose next_due_at has passed (cross-org engine sweep). */
  async getDueEnrolmentIds(limit = 200): Promise<string[]> {
    const rows = await getDueEnrolments(this.db, this.now(), limit);
    return rows.map((r) => r.id);
  }

  async advanceEnrolment(enrolmentId: string): Promise<AdvanceOutcome> {
    const enrolment = await getEnrolmentForEngine(this.db, enrolmentId);
    if (!enrolment || enrolment.status !== "active") {
      return { status: "skipped", reason: "not_active" };
    }

    const ctx = await getEnrolmentEntityContext(this.db, {
      organizationId: enrolment.organizationId,
      companyId: enrolment.companyId,
      contactId: enrolment.contactId,
    });
    if (!ctx) {
      await this.end(enrolmentId, "manual");
      return { status: "ended", reason: "manual" };
    }

    // Hard reject : opted out.
    if (ctx.contact.optedOut) {
      await this.end(enrolmentId, "opted_out");
      return { status: "ended", reason: "opted_out" };
    }

    // Resolve the live step (id first, order fallback after a publish swap).
    const steps = await getStepsForSequence(this.db, enrolment.sequenceId);
    const step =
      steps.find((s) => s.id === enrolment.currentStepId) ??
      steps.find((s) => s.stepOrder === enrolment.currentStepOrder);
    if (!step) {
      await this.end(enrolmentId, "exhausted");
      return { status: "ended", reason: "exhausted" };
    }

    // Terminal-step re-entry guard. When the engine reaches a step that has
    // no outgoing edges AND that step's `awaitTaskCompletion=true` executor
    // result asked to wait, we park the enrolment on this step instead of
    // ending immediately (so the UI / enrolment.status reflects "still
    // waiting on the rep / agent"). When the task gets closed,
    // `sequences/task.completed` re-enters here ; this guard sees the step
    // already has an executed row, so we end the enrolment now.
    //
    // Terminal := no outgoing nextStepIds at all. A step with branches that
    // all happen to be null at runtime is still treated as terminal — same
    // as the post-execution branch below.
    if (isTerminalStep(step) && (await stepHasExecutedRow(this.db, enrolmentId, step.id))) {
      await this.end(enrolmentId, "exhausted");
      return { status: "ended", reason: "exhausted" };
    }

    // Slice D — read sequence-level outcome strategy (with the step-level
    // override resolved later). Single direct fetch on the admin pool : the
    // engine is already trusted cross-org.
    const sequenceRow = await this.db.query.sequences.findFirst({
      where: eq(sequencesTable.id, enrolment.sequenceId),
      columns: { unknownOutcomeStrategy: true },
    });

    // Loop safety.
    const nextCounter = enrolment.lastExecutionCounter + 1;
    if (nextCounter > enrolment.maxExecutionCount) {
      await this.end(enrolmentId, "safety_loop_cap_reached");
      return { status: "ended", reason: "safety_loop_cap_reached" };
    }

    // Idempotence pre-check (the UNIQUE index is the real guard).
    if (await executionCounterExists(this.db, enrolmentId, nextCounter)) {
      return { status: "skipped", reason: "already_executed" };
    }

    const enrolmentCtx: SequenceEnrolmentCtx = {
      id: enrolment.id,
      organizationId: enrolment.organizationId,
      sequenceId: enrolment.sequenceId,
      companyId: enrolment.companyId,
      contactId: enrolment.contactId,
      assigneeId: enrolment.assigneeId,
      currentStepId: step.id,
      currentStepOrder: step.stepOrder,
      lastExecutionCounter: enrolment.lastExecutionCounter,
      maxExecutionCount: enrolment.maxExecutionCount,
    };

    const stepCtx: SequenceStepCtx = {
      id: step.id,
      stepOrder: step.stepOrder,
      actionType: step.actionType,
      actionConfig: step.actionConfig,
      nextStepIds: step.nextStepIds,
      condition: step.condition,
      filter: step.filter,
    };

    const interactions = await getInteractionsSince(
      this.db,
      enrolment.organizationId,
      enrolment.contactId,
      enrolment.startedAt,
    );
    const predicateCtx = {
      contact: ctx.contact,
      company: ctx.company,
      organization: ctx.organization,
      enrolment: enrolmentCtx,
      recentInteractions: interactions,
      now: this.now(),
    };

    // Filter gate.
    if (!SequencePredicateEvaluatorFactory.evaluate(step.filter, predicateCtx)) {
      return this.logSkipAndAdvance(enrolmentCtx, step, nextCounter, "skipped_filter");
    }
    // Condition gate.
    if (!SequencePredicateEvaluatorFactory.evaluate(step.condition, predicateCtx)) {
      return this.logSkipAndAdvance(enrolmentCtx, step, nextCounter, "skipped_condition");
    }

    // Slice D — outcome-awaiting gate.
    //
    // If this step's logic depends on a qualified reply outcome (positive
    // or negative branches in a conditional_split / conditional_switch)
    // and the enrolment has seen an inbound reply that's not yet
    // qualified, decide via the effective strategy whether to park or
    // continue. "park" sets next_due_at = NULL ; the
    // `sequences/outcome.qualified` event re-fires the engine when the
    // outcome gets set (LLM auto-apply or manual confirm).
    if (
      conditionDependsOnReplyOutcome(extractStepConditionGroup(step)) &&
      hasUnqualifiedInboundReply(interactions)
    ) {
      const strategy = resolveUnknownOutcomeStrategy({
        sequence: sequenceRow?.unknownOutcomeStrategy ?? null,
        step: step.unknownOutcomeStrategy,
      });
      if (strategy === "park") {
        await parkEnrolmentAwaitingOutcome(this.db, enrolment.id);
        return { status: "parked", reason: "awaiting_outcome" };
      }
      // strategy === "continue_default" → fall through ; the predicate
      // evaluators will read `outcome != null` as false for positiveReply
      // / negativeReply, so the executor branches to default.
    }

    // Execute.
    const executor = SequenceStepExecutorFactory.forActionType(step.actionType);
    const execCtx: StepExecutionContext = {
      enrolment: enrolmentCtx,
      step: stepCtx,
      contact: ctx.contact,
      company: ctx.company,
      organization: ctx.organization,
      userId: enrolment.assigneeId,
      services: this.services,
      // Logic steps (conditional_split) branch via the same predicate context.
      evaluatePredicate: (predicate) =>
        SequencePredicateEvaluatorFactory.evaluate(predicate, predicateCtx),
      now: this.now(),
    };
    const result = await executor.execute(execCtx);

    await insertStepExecution(this.db, {
      enrolmentId: enrolment.id,
      stepId: step.id,
      stepOrder: step.stepOrder,
      actionType: step.actionType,
      executionCounter: nextCounter,
      outcome: "executed",
      taskId: result.taskId ?? null,
      notes: result.notes ?? null,
    });

    if (result.markEnded) {
      await this.end(enrolment.id, result.markEnded);
      return { status: "ended", reason: result.markEnded };
    }

    const navigatedTo = result.navigateTo ?? "default";
    const nextStepId = pickNext(step.nextStepIds, navigatedTo);
    const nextStep = nextStepId ? steps.find((s) => s.id === nextStepId) : undefined;

    if (!nextStep) {
      // No outgoing edge → reached a terminal point.
      //
      // If the terminal step is a human-action step (awaitTaskCompletion=true),
      // we must NOT end the enrolment now — the task is just born, the rep /
      // agent hasn't closed it yet. Park the enrolment on this step
      // (next_due_at = null, ignored by the cron sweep) and wait for
      // `sequences/task.completed` to re-enter ; the guard at the top of
      // advanceEnrolment (`isTerminalStep + stepHasExecutedRow`) ends the
      // enrolment then. `awaitTaskTimeoutMs` provides a fallback wake-up.
      if (result.awaitTaskCompletion) {
        const nextDueAt =
          result.awaitTaskTimeoutMs != null
            ? new Date(this.now().getTime() + result.awaitTaskTimeoutMs)
            : null;
        await advanceEnrolment(this.db, enrolment.id, {
          currentStepId: step.id,
          currentStepOrder: step.stepOrder,
          nextDueAt,
          lastExecutionCounter: nextCounter,
        });
        return { status: "executed", taskId: result.taskId ?? null, navigatedTo };
      }
      // Pure leaf (e.g. wait_delay at the end, or a non-blocking action) —
      // nothing more to do, end immediately.
      await this.end(enrolment.id, "exhausted");
      return { status: "ended", reason: "exhausted" };
    }

    // Human-action steps (send_email / send_linkedin / phone_call) set
    // `awaitTaskCompletion = true` — the engine pauses the cursor by setting
    // `next_due_at = null` (indefinite wait, ignored by the cron sweep). The
    // `sequences/task.completed` event re-fires `handleAdvance` when the rep
    // closes the task, supplying the wake-up. If the step config sets
    // `awaitTaskTimeoutMs`, the engine schedules a fallback resume at that
    // horizon — useful for "give up after 2 weeks if the rep ignored the
    // task" patterns. Default (no timeout) is wait-forever.
    const nextDueAt = result.awaitTaskCompletion
      ? result.awaitTaskTimeoutMs != null
        ? new Date(this.now().getTime() + result.awaitTaskTimeoutMs)
        : null
      : new Date(this.now().getTime() + (result.delayMs ?? 0));

    await advanceEnrolment(this.db, enrolment.id, {
      currentStepId: nextStep.id,
      currentStepOrder: nextStep.stepOrder,
      nextDueAt,
      lastExecutionCounter: nextCounter,
    });

    return { status: "executed", taskId: result.taskId ?? null, navigatedTo };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async logSkipAndAdvance(
    enrolmentCtx: SequenceEnrolmentCtx,
    step: SequenceStepRow,
    counter: number,
    outcome: "skipped_filter" | "skipped_condition",
  ): Promise<AdvanceOutcome> {
    await insertStepExecution(this.db, {
      enrolmentId: enrolmentCtx.id,
      stepId: step.id,
      stepOrder: step.stepOrder,
      actionType: step.actionType,
      executionCounter: counter,
      outcome,
    });

    const nextStepId = pickNext(step.nextStepIds, "default");
    const steps = await getStepsForSequence(this.db, enrolmentCtx.sequenceId);
    const nextStep = nextStepId ? steps.find((s) => s.id === nextStepId) : undefined;

    if (!nextStep) {
      await this.end(enrolmentCtx.id, "exhausted");
      return { status: "ended", reason: "exhausted" };
    }

    await advanceEnrolment(this.db, enrolmentCtx.id, {
      currentStepId: nextStep.id,
      currentStepOrder: nextStep.stepOrder,
      nextDueAt: this.now(),
      lastExecutionCounter: counter,
    });
    return { status: "skipped", reason: outcome };
  }

  private async end(enrolmentId: string, reason: SequenceEndReason): Promise<void> {
    await endEnrolment(this.db, enrolmentId, reason, this.now());
  }
}

/**
 * Slice D — pull the composite ConditionGroup(s) carried by a step so the
 * outcome-strategy gate can ask "does this branch read positive/negative
 * reply?". Only conditional_split / conditional_switch carry one inline ;
 * other action types route by their `step.condition` predicate, which the
 * engine already evaluated above.
 */
function extractStepConditionGroup(step: SequenceStepRow): ConditionGroup | null {
  if (step.actionType === "conditional_split") {
    const cfg = step.actionConfig as { condition?: ConditionGroup };
    return cfg?.condition ?? null;
  }
  if (step.actionType === "conditional_switch") {
    const cfg = step.actionConfig as { branches?: { condition: ConditionGroup }[] };
    const branches = cfg?.branches ?? [];
    // Synthesize an OR group over every branch's condition so the
    // "depends on outcome?" walker visits all of them in one pass.
    return {
      kind: "group",
      op: "or",
      conditions: branches
        .map((b) => b.condition)
        .filter((c): c is ConditionGroup => Boolean(c)),
    };
  }
  return null;
}

/** Resolve the next step id for a navigation key. Phase A uses 'default'. */
function pickNext(next: NextStepIds, key: string): string | undefined {
  if (!next) return undefined;
  if (key === "yes") return next.yes ?? next.default;
  if (key === "no") return next.no ?? next.default;
  if (key === "default") return next.default;
  return next.cases?.[key] ?? next.default;
}

/** True when a step has no outgoing edges at all — reaching it means the
 *  engine has nowhere to go next regardless of the executor's navigateTo
 *  result. Mirrors the post-execution `!nextStep` branch but is callable
 *  before execution (for the terminal-step re-entry guard). */
function isTerminalStep(step: SequenceStepRow): boolean {
  const n = step.nextStepIds;
  if (!n) return true;
  if (n.default || n.yes || n.no) return false;
  if (n.cases && Object.values(n.cases).some((v) => v)) return false;
  return true;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Building2, Circle, User, Workflow } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { getEnrolmentDetail } from "@/db/queries/sequence-enrolments";
import { getSequenceWithSteps } from "@/db/queries/sequences";
import { listExecutionsForEnrolment } from "@/db/queries/sequence-executions";
import { getTasksByIds } from "@/db/queries/tasks";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { publishedStepsToDraft } from "@/lib/sequences/draft-from-steps";
import type { WaitDelayActionConfig, SequenceDelayUnit } from "@/lib/sequences/types";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SequenceFlowView } from "@/components/app/sequences/sequence-flow-view";
import { Countdown } from "@/components/app/sequences/countdown";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Enrolment detail page : the destination of the "step N/M" badges shown on
 * tasks. Goal is traceability — show how an enrolment is progressing through
 * its sequence (read-only diagram + execution timeline). Lifecycle actions
 * (pause / resume / stop) are intentionally deferred to a follow-up : the
 * underlying service methods don't exist yet and we don't want to ship UI
 * buttons that lead to dead code.
 */
export default async function EnrolmentDetailPage({
  params,
}: {
  params: Promise<{ id: string; enrolmentId: string }>;
}) {
  const { id, enrolmentId } = await params;
  const { activeOrganization } = await getActiveOrg();
  const db = getDb();

  const enrolment = await getEnrolmentDetail(db, activeOrganization.id, enrolmentId);
  if (!enrolment || enrolment.sequenceId !== id) notFound();

  const [data, executions, t, locale] = await Promise.all([
    getSequenceWithSteps(db, activeOrganization.id, id),
    listExecutionsForEnrolment(db, enrolmentId),
    getTranslations("pages.sequences"),
    getLocale(),
  ]);
  if (!data) notFound();

  const taskIds = executions
    .map((e) => e.taskId)
    .filter((v): v is string => Boolean(v));
  const tasks = await getTasksByIds(activeOrganization.id, taskIds);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const contactName = resolveContactDisplayName({
    kind: enrolment.contactKind,
    firstName: enrolment.contactFirstName,
    lastName: enrolment.contactLastName,
  });

  const totalSteps = data.steps.length;
  const orgLocale = activeOrganization.defaultLocale;
  const triggerSummary = [
    ...data.sequence.targetRelationshipTypes,
    ...data.sequence.targetSiteTypes,
    ...data.sequence.targetContactRoles,
  ].join(" · ");

  // Per-step runtime status for the diagram coloring + timeline rendering.
  // - "executed" : engine ran the step AND any task it created is closed
  // - "awaiting" : engine ran the step (task created) but the rep hasn't
  //                closed the task yet — sequence is logically blocked here
  // - "current"  : engine cursor parked on the step (next to run)
  // Idle / ended enrolments do not surface a "current" step.
  const executedExecutions = executions
    .filter((e) => e.outcome === "executed")
    .sort((a, b) => a.executionCounter - b.executionCounter);
  const executedStepIds = new Set(executedExecutions.map((e) => e.stepId));
  const isActive = enrolment.status === "active" || enrolment.status === "paused";
  const currentStep = isActive
    ? data.steps.find((s) => s.id === enrolment.currentStepId)
    : null;

  // An execution is fully done when either it didn't create a task or the
  // task it created is in "completed" status. Anything else (pending,
  // in_progress) means the rep still owes work — colour the step violet
  // and stop the green path there.
  const isExecutionFullyDone = (exec: { taskId: string | null }): boolean => {
    if (!exec.taskId) return true;
    const task = taskById.get(exec.taskId);
    return !task || task.status === "completed";
  };

  // Special case : a wait_delay row is "executed" in the engine's eyes the
  // instant it runs (the engine then parks `next_due_at` on the NEXT step).
  // UX-wise the wait itself is what's "in progress" — show it that way.
  const now = new Date();
  const lastExec = executedExecutions[executedExecutions.length - 1] ?? null;
  const waitInProgress =
    isActive &&
    lastExec?.actionType === "wait_delay" &&
    enrolment.nextDueAt != null &&
    new Date(enrolment.nextDueAt) > now;
  const waitInProgressExecutionId = waitInProgress ? lastExec!.id : null;
  const waitResumeAt: Date | null =
    waitInProgress && enrolment.nextDueAt ? new Date(enrolment.nextDueAt) : null;

  // True if the last execution is a task-creating step whose task isn't done.
  // When this is the case, the sequence is "stuck on the human action" : the
  // green path stops on that step, the cursor's pointed-at step is NOT shown
  // as current, and the row gets the "awaitingTask" badge.
  const waitingForTask = isActive && lastExec != null && !isExecutionFullyDone(lastExec);

  const stepStates: Record<string, "executed" | "awaiting" | "current"> = {};
  for (const exec of executedExecutions) {
    stepStates[exec.stepId] = isExecutionFullyDone(exec) ? "executed" : "awaiting";
  }
  // Reclassify the in-progress wait step from "executed" → "current".
  if (waitInProgress && lastExec) stepStates[lastExec.stepId] = "current";
  // Only mark the cursor step as current when nothing earlier is still
  // pending — neither a wait running ahead of it, nor an unfinished task.
  if (
    currentStep &&
    !executedStepIds.has(currentStep.id) &&
    !waitInProgress &&
    !waitingForTask
  ) {
    stepStates[currentStep.id] = "current";
  }

  // Edges actually traversed by the cursor : chain executed steps together,
  // anchor the first one to the trigger, and link the last execution to the
  // step the cursor is parked on (if any). Format `"source->target"` —
  // `buildSequenceGraph` matches that against its edge ids.
  const TRIGGER_NODE_ID = "__trigger";
  const traversedEdges = new Set<string>();
  if (executedExecutions[0]) {
    traversedEdges.add(`${TRIGGER_NODE_ID}->${executedExecutions[0].stepId}`);
  } else if (currentStep) {
    // Edge case : current step parked but nothing executed yet (very first
    // tick before any step runs). The path from trigger to current is still
    // "the path so far".
    traversedEdges.add(`${TRIGGER_NODE_ID}->${currentStep.id}`);
  }
  // Chain edges only between fully-done executions — an unfinished task on
  // step N stops the green path right there (matches the violet "awaiting"
  // step colouring : the cursor hasn't really moved past it yet).
  for (let i = 1; i < executedExecutions.length; i++) {
    const prev = executedExecutions[i - 1]!;
    const next = executedExecutions[i]!;
    if (isExecutionFullyDone(prev)) {
      traversedEdges.add(`${prev.stepId}->${next.stepId}`);
    }
  }
  // Extend the green path to the cursor's step only when nothing in front
  // is still pending : no wait in progress, no task hanging open.
  if (
    currentStep &&
    executedExecutions.length > 0 &&
    !waitInProgress &&
    !waitingForTask
  ) {
    const last = executedExecutions[executedExecutions.length - 1]!;
    traversedEdges.add(`${last.stepId}->${currentStep.id}`);
  }
  const triggerExecuted = executedExecutions.length > 0 || currentStep != null;

  // Resolve a step's wait config (value + unit) if it's a wait_delay. Used to
  // render the actual duration on past wait rows ("Attente 2 jours") instead
  // of the generic action-type label.
  const stepById = new Map(data.steps.map((s) => [s.id, s]));
  const readWaitConfig = (stepId: string) => {
    const step = stepById.get(stepId);
    if (!step || step.actionType !== "wait_delay") return null;
    const cfg = step.actionConfig as WaitDelayActionConfig;
    return { value: cfg.durationValue, unit: cfg.durationUnit };
  };

  // Timeline = historical executions, plus a synthetic "current" row when the
  // enrolment is parked on a step that hasn't run yet. The current row has
  // no execution counter / executedAt — it's a sentinel for the next action.
  type TimelineRow =
    | {
        kind: "execution";
        id: string;
        stepOrder: number;
        actionType: string;
        outcome: string;
        executedAt: Date;
        taskId: string | null;
        notes: string | null;
        wait: { value: number; unit: SequenceDelayUnit } | null;
      }
    | {
        kind: "current";
        id: string;
        stepOrder: number;
        actionType: string;
        wait: { value: number; unit: SequenceDelayUnit } | null;
      };
  const timeline: TimelineRow[] = executions.map((e) => {
    // The "wait in progress" execution row is rendered as the current step
    // (red badge + countdown) instead of "executed" — see waitInProgress.
    if (e.id === waitInProgressExecutionId) {
      return {
        kind: "current",
        id: `current:${e.id}`,
        stepOrder: e.stepOrder,
        actionType: e.actionType,
        wait: readWaitConfig(e.stepId),
      };
    }
    return {
      kind: "execution",
      id: e.id,
      stepOrder: e.stepOrder,
      actionType: e.actionType,
      outcome: e.outcome,
      executedAt: e.executedAt,
      taskId: e.taskId,
      notes: e.notes,
      wait: readWaitConfig(e.stepId),
    };
  });
  // Synthetic current row for the step the cursor points at — but only when
  // nothing earlier is still holding the floor : neither a wait running ahead
  // of it, nor an unfinished task on the previous step (waitingForTask). In
  // those cases the row that's actually "in progress" is the previous one
  // (already rendered above with its violet / red badge).
  if (
    currentStep &&
    !executedStepIds.has(currentStep.id) &&
    !waitInProgress &&
    !waitingForTask
  ) {
    timeline.push({
      kind: "current",
      id: `current:${currentStep.id}`,
      stepOrder: currentStep.stepOrder,
      actionType: currentStep.actionType,
      wait: readWaitConfig(currentStep.id),
    });
  }

  // Resume moment + countdown for the in-progress wait. `next_due_at` is the
  // engine's wake-up after the wait ; if we have it, render a deadline + live
  // countdown on the row.
  const currentWaitResumeAt: Date | null = waitResumeAt;

  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href={`/sequences/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("enrolment.backToSequence")}
      </Link>

      <PageHeader
        title={contactName}
        subtitle={data.sequence.name}
        right={
          <span
            className={cn(
              "shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border",
              enrolment.status === "active"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : enrolment.status === "paused"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-secondary text-muted-foreground border-border",
            )}
          >
            {t(`enrolmentStatus.${enrolment.status}`)}
          </span>
        }
      />

      <section className="mb-8 grid gap-3 sm:grid-cols-2">
        <Card className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="h-4 w-4" />
            <Link href={`/contacts/${enrolment.contactId}`} className="hover:text-foreground">
              {contactName}
            </Link>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <Link href={`/companies/${enrolment.companyId}`} className="hover:text-foreground">
              {enrolment.companyName}
            </Link>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Workflow className="h-4 w-4" />
            <span>
              {t("enrolment.stepPosition", {
                current: enrolment.currentStepOrder + 1,
                total: totalSteps,
              })}
            </span>
          </div>
        </Card>
        <Card className="p-4 space-y-1.5 text-sm">
          <p className="text-muted-foreground">
            {t("enrolment.startedOn", { date: dateTime.format(enrolment.startedAt) })}
          </p>
          {enrolment.endedAt ? (
            <p className="text-muted-foreground">
              {t("enrolment.endedOn", { date: dateTime.format(enrolment.endedAt) })}
            </p>
          ) : enrolment.nextDueAt ? (
            <p className="text-muted-foreground">
              {t("enrolment.nextDue", { date: dateTime.format(enrolment.nextDueAt) })}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("enrolment.noNextDue")}</p>
          )}
          {enrolment.endReason ? (
            <p className="text-foreground">
              {t(`enrolment.endReason.${enrolment.endReason}`)}
            </p>
          ) : null}
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium text-muted-foreground mb-3">{t("sections.steps")}</h2>
        {data.steps.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={Circle} title={t("noSteps")} />
          </Card>
        ) : (
          <SequenceFlowView
            draft={publishedStepsToDraft(data.steps)}
            orgLocale={orgLocale}
            triggerSummary={triggerSummary}
            stepStates={stepStates}
            traversedEdges={traversedEdges}
            triggerExecuted={triggerExecuted}
          />
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          {t("enrolment.timeline.title")}
        </h2>
        {timeline.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={Circle} title={t("enrolment.timeline.empty")} />
          </Card>
        ) : (
          <Card className="divide-y divide-border">
            {timeline.map((row) => {
              // Action label : wait_delay rows surface the configured duration
              // ("Attente 2 jours") instead of the bare type label.
              const actionLabel = row.wait
                ? t("enrolment.timeline.waitFor", {
                    value: row.wait.value,
                    unit: t(`enrolment.timeline.unit.${row.wait.unit}`, { n: row.wait.value }),
                  })
                : t(`stepType.${row.actionType}`);

              if (row.kind === "current") {
                return (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-3 p-3 bg-rose-50/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {t("enrolment.timeline.stepLabel", { order: row.stepOrder + 1 })}
                        </span>
                        <span>·</span>
                        <span>{actionLabel}</span>
                      </div>
                      {currentWaitResumeAt && row.actionType === "wait_delay" && (
                        <p className="text-xs text-foreground mt-1">
                          {t("enrolment.timeline.resumeAt", {
                            date: dateTime.format(currentWaitResumeAt),
                          })}
                          {" · "}
                          <span className="text-rose-700">
                            {t("enrolment.timeline.resumeIn")}{" "}
                            <Countdown targetIso={currentWaitResumeAt.toISOString()} />
                          </span>
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                      {t("enrolment.timeline.outcome.current")}
                    </span>
                  </div>
                );
              }
              const task = row.taskId ? taskById.get(row.taskId) : null;
              // Engine-executed row whose underlying task is still open →
              // the sequence is logically blocked here. Surface that with a
              // violet "awaiting" badge instead of green "executed".
              const isAwaitingTask =
                row.outcome === "executed" && task != null && task.status !== "completed";
              return (
                <div
                  key={row.id}
                  className={cn(
                    "flex items-start justify-between gap-3 p-3",
                    isAwaitingTask && "bg-violet-50/30",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{dateTime.format(row.executedAt)}</span>
                      <span>·</span>
                      <span>
                        {t("enrolment.timeline.stepLabel", { order: row.stepOrder + 1 })}
                      </span>
                      <span>·</span>
                      <span>{actionLabel}</span>
                    </div>
                    {task ? (
                      <Link
                        href={`/tasks/${task.id}`}
                        className="text-sm font-medium text-foreground hover:text-primary transition-colors mt-0.5 inline-block"
                      >
                        {task.title}
                      </Link>
                    ) : row.notes ? (
                      <p className="text-sm text-foreground mt-0.5">{row.notes}</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border",
                      isAwaitingTask
                        ? "bg-violet-50 text-violet-700 border-violet-200"
                        : row.outcome === "executed"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-secondary text-muted-foreground border-border",
                    )}
                  >
                    {isAwaitingTask
                      ? t("enrolment.timeline.outcome.awaiting_task")
                      : t(`enrolment.timeline.outcome.${row.outcome as "executed" | "skipped_filter" | "skipped_condition"}`)}
                  </span>
                </div>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}

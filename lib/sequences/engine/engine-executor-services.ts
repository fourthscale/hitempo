import "server-only";
import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contacts, tasks } from "@/db/schema";
import { insertTaskForEnrolment } from "@/db/queries/tasks";
import { inngest } from "@/lib/inngest/client";
import { EVENT_TASK_AUTO_EXECUTE } from "./events";
import {
  loadAssigneeTasksInWindow,
  loadSchedulingContext,
} from "@/db/queries/sequence-task-scheduling";
import type { SequenceExecutorServices } from "../step-executor";
import { SequenceEnrolmentService } from "../sequence-enrolment-service";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSenderName as deriveSenderName } from "@/lib/auth/sender-name";
import {
  computeTaskSchedule,
  DEFAULT_SCHEDULING,
  NoSchedulableSlotError,
  type TaskScheduling,
} from "../scheduling";
import {
  findNextFreeSlot,
  NoFreeSlotError,
  type TaskTypeKey,
} from "../task-slot-finder";
import { ThreadingResolver, type ThreadContext } from "./threading-resolver";
import type { ThreadingMode } from "../types";

/**
 * Production implementation of the executor side-effect contract, bound to the
 * admin pool (the engine runs outside an RLS user session).
 *
 * Phase A note : `generateDraftForTask` is a deliberate no-op. Generating the
 * AI draft at cron time would (a) fight RLS — the message orchestrator reads
 * through the RLS pool — and (b) produce a stale draft. Instead the task is
 * created now and the rep generates a fresh draft on open via the existing
 * GenerateMessageDialog (the step's action_config carries channel/intent/
 * orientation so the dialog pre-fills). The structure is fully in place ; only
 * the cron-time generation is deferred.
 */
export class EngineExecutorServices implements SequenceExecutorServices {
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly threadingResolver: ThreadingResolver;

  constructor(deps: { db: Db; now?: () => Date }) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
    this.threadingResolver = new ThreadingResolver(this.db);
  }

  async createTask(input: {
    organizationId: string;
    companyId: string;
    contactId: string;
    assigneeId: string | null;
    sequenceEnrolmentId: string;
    type: string;
    title: string;
    description: string | null;
    scheduling?: TaskScheduling;
    /** Sprint 15 — pre-resolved Gmail thread context. See
     *  SequenceExecutorServices.createTask doc. */
    gmailThreadId?: string | null;
    gmailReplyToMessageId?: string | null;
    subject?: string | null;
    mailReferences?: string | null;
  }): Promise<{ taskId: string; scheduledFor: Date | null }> {
    // 1. Resolve TZ cascades + assignee work pattern + quotas.
    const { contactTz, assigneeMember } = await loadSchedulingContext(
      this.db,
      input.organizationId,
      input.contactId,
      input.assigneeId,
    );

    // 2. Compute the contact-side wanted moment (scheduledFor + dueAt).
    const merged: TaskScheduling = { ...DEFAULT_SCHEDULING, ...(input.scheduling ?? {}) };
    let scheduledFor: Date | null = null;
    let dueAt: Date | null = null;
    let dueAtAllDay = false;
    try {
      const r = computeTaskSchedule(this.now(), merged, contactTz);
      scheduledFor = r.scheduledFor;
      dueAt = r.dueAt;
      dueAtAllDay = r.dueAtAllDay;
    } catch (e) {
      // No schedulable slot on contact side (extreme weekday config). Fall
      // through with null dates — the task still appears, unscheduled.
      if (!(e instanceof NoSchedulableSlotError)) throw e;
    }

    // 3. Snap to a free slot in the sale's agenda (anti-conflict + quotas).
    //    Only when we have both a target moment AND a real assignee with
    //    a work pattern to honour.
    if (scheduledFor && assigneeMember) {
      const durationMin =
        merged.estimatedDurationMinutes ?? DEFAULT_SCHEDULING.estimatedDurationMinutes;
      const existing = await loadAssigneeTasksInWindow(
        this.db,
        input.organizationId,
        assigneeMember.userId,
        scheduledFor,
        addDays(scheduledFor, 14),
      );
      try {
        scheduledFor = findNextFreeSlot(
          scheduledFor,
          durationMin,
          input.type as TaskTypeKey,
          {
            timezone: assigneeMember.timezone,
            workPattern: assigneeMember.workPattern,
            maxEmailsPerDay: assigneeMember.maxEmailsPerDay,
            maxCallsPerDay: assigneeMember.maxCallsPerDay,
          },
          existing,
        );
      } catch (e) {
        // Sale saturated for 14 days. Don't fail the engine — keep the
        // unsnapped scheduledFor (the user can replan manually).
        if (!(e instanceof NoFreeSlotError)) throw e;
      }
    }

    const row = await insertTaskForEnrolment(this.db, input.organizationId, {
      assigneeId: input.assigneeId,
      sequenceEnrolmentId: input.sequenceEnrolmentId,
      type: input.type as Parameters<typeof insertTaskForEnrolment>[2]["type"],
      title: input.title,
      description: input.description,
      companyId: input.companyId,
      contactId: input.contactId,
      scheduledFor,
      dueAt,
      dueAtAllDay,
      estimatedDurationMinutes:
        merged.estimatedDurationMinutes ?? DEFAULT_SCHEDULING.estimatedDurationMinutes,
      gmailThreadId: input.gmailThreadId ?? null,
      gmailReplyToMessageId: input.gmailReplyToMessageId ?? null,
      subject: input.subject ?? null,
      mailReferences: input.mailReferences ?? null,
    });
    return { taskId: row.id, scheduledFor };
  }

  async generateDraftForTask(): Promise<{ drafted: boolean }> {
    // Phase A : deferred to on-open generation (see class docstring).
    return { drafted: false };
  }

  async cascadeEnrol(input: {
    targetSequenceId: string;
    startAtStep: number;
    organizationId: string;
    companyId: string;
    contactId: string;
    assigneeId: string | null;
  }): Promise<{ enrolmentId: string | null; skippedReason?: string }> {
    const service = new SequenceEnrolmentService({ db: this.db, now: this.now });
    const result = await service.enrollContact(input.organizationId, {
      sequenceId: input.targetSequenceId,
      contactId: input.contactId,
      companyId: input.companyId,
      assigneeId: input.assigneeId,
    });
    return result.ok
      ? { enrolmentId: result.enrolmentId }
      : { enrolmentId: null, skippedReason: result.reason };
  }

  /**
   * Sprint 12 — resolves the assignee's name from Supabase auth so the
   * `send_email` defined-mode renderer can substitute `{{sender.*}}`
   * placeholders. Runs on the service-role admin client (cross-tenant).
   * Returns null on any lookup failure — the renderer falls back to the
   * template's `|| 'fallback'` clause, or leaves the slot empty.
   */
  async getSenderName(userId: string): Promise<{ firstName: string; lastName: string } | null> {
    try {
      const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(userId);
      if (error || !data.user) return null;
      const name = deriveSenderName({
        email: data.user.email ?? null,
        user_metadata: (data.user.user_metadata as Record<string, unknown>) ?? null,
      });
      return name;
    } catch {
      return null;
    }
  }

  /**
   * Sprint 12 phase 4 — flips the task into the agent auto-execution
   * pipeline. Two side effects, both best-effort :
   *   1. UPDATE tasks SET auto_execution_status = 'pending' — so the UI
   *      can label the row and the Inngest handler refuses to act on
   *      tasks where this flag has been cleared (= human took over).
   *   2. Emit `sequences/task.auto-execute` so the handler picks the
   *      task up. The handler's `sleepUntil(scheduledFor)` honours the
   *      step's scheduling config (heures ouvrées, anti-conflit).
   *
   * Errors are caught + logged ; the engine step has already created
   * the task and we don't want to roll that back. A failed schedule
   * leaves the task in the human queue (graceful fallback).
   */
  async scheduleAgentAutoExecute(input: {
    organizationId: string;
    taskId: string;
    scheduledFor: Date | null;
  }): Promise<void> {
    // Defensive — never flag-pending or emit an event for an empty taskId.
    // Without this guard, a transient `createTask` regression that returns
    // `{taskId: undefined, ...}` would (a) UPDATE every task in the org and
    // (b) emit a poisoned Inngest event that loops through retries forever.
    if (!input.taskId) {
      console.error(
        "[EngineExecutorServices.scheduleAgentAutoExecute] refusing to schedule with empty taskId",
        { organizationId: input.organizationId },
      );
      return;
    }
    try {
      await this.db
        .update(tasks)
        .set({
          autoExecutionStatus: "pending",
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.taskId), eq(tasks.organizationId, input.organizationId)));
    } catch (err) {
      console.error(
        "[EngineExecutorServices.scheduleAgentAutoExecute] flag-pending failed",
        err,
      );
      return; // No point firing the event if the flag isn't set.
    }
    try {
      await inngest.send({
        name: EVENT_TASK_AUTO_EXECUTE,
        data: {
          organizationId: input.organizationId,
          taskId: input.taskId,
          scheduledFor: input.scheduledFor ? input.scheduledFor.toISOString() : null,
        },
      });
    } catch (err) {
      console.error(
        "[EngineExecutorServices.scheduleAgentAutoExecute] event emit failed",
        err,
      );
    }
  }

  async resolveThreadContext(input: {
    organizationId: string;
    contactId: string;
    enrolmentId: string;
    mode: ThreadingMode;
  }): Promise<ThreadContext | null> {
    return this.threadingResolver.resolve(input);
  }

  async updateContact(input: {
    organizationId: string;
    contactId: string;
    patch: { status?: string; role?: string };
  }): Promise<void> {
    const set: Record<string, unknown> = {};
    if (input.patch.status) set.status = input.patch.status;
    if (input.patch.role) set.role = input.patch.role;
    if (Object.keys(set).length === 0) return;
    set.updatedAt = new Date();
    await this.db
      .update(contacts)
      .set(set)
      .where(and(eq(contacts.organizationId, input.organizationId), eq(contacts.id, input.contactId)));
  }
}

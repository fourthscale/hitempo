import "server-only";
import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contacts } from "@/db/schema";
import { insertTaskForEnrolment } from "@/db/queries/tasks";
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

  constructor(deps: { db: Db; now?: () => Date }) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
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
  }): Promise<{ taskId: string }> {
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
    });
    return { taskId: row.id };
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

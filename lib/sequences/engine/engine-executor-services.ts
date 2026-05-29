import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contacts } from "@/db/schema";
import { insertTaskForEnrolment } from "@/db/queries/tasks";
import type { SequenceExecutorServices } from "../step-executor";
import { SequenceEnrolmentService } from "../sequence-enrolment-service";

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
  }): Promise<{ taskId: string }> {
    const row = await insertTaskForEnrolment(this.db, input.organizationId, {
      assigneeId: input.assigneeId,
      sequenceEnrolmentId: input.sequenceEnrolmentId,
      type: input.type as Parameters<typeof insertTaskForEnrolment>[2]["type"],
      title: input.title,
      description: input.description,
      companyId: input.companyId,
      contactId: input.contactId,
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

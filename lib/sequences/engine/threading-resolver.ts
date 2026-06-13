import "server-only";
import { and, asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  interactions,
  messages,
  sequenceStepExecutions,
  tasks,
} from "@/db/schema";
import type { ThreadingMode } from "../types";

/**
 * Sprint 15 — resolves the thread context the engine should attach to a
 * `send_email` task at creation time, based on the step's `threadingMode`.
 *
 * The resolver runs against the admin pool (the engine sits outside an
 * RLS session). It returns null when no previous thread is reachable —
 * the caller leaves the task's `gmail_thread_id` / `gmail_reply_to_message_id`
 * / `subject` NULL and the send path naturally falls back to a fresh thread.
 *
 * Design notes :
 *  - `new_thread` short-circuits with `null` (no DB call).
 *  - `last_email_step` + `entry_email_step` look at
 *    `sequence_step_executions` rows of this enrolment that already have
 *    a `gmail_thread_id` (= a successful prior send_email). The partial
 *    index `idx_seq_executions_thread` keeps the lookup cheap.
 *  - `last_answered_step` walks the most recent inbound interaction of
 *    the enrolment's contact whose underlying outbound `message` is
 *    linked (via its task) to THIS enrolment, then looks up the step
 *    execution that owns the matching thread. Falls back to
 *    `last_email_step` when no inbound reply has been recorded yet.
 */
export type ThreadContext = {
  threadId: string;
  replyToMessageId: string;
  subject: string;
  /**
   * Sprint 15 — full RFC 5322 References chain (space-separated message-ids
   * with angle brackets, oldest → newest, INCLUDING the parent at the end).
   * Built by walking every prior `sequence_step_executions` row of this
   * enrolment that carries a `gmail_message_id`, ordered by execution
   * counter ASC. Stamped on the task at creation time and emitted verbatim
   * in the MIME `References:` header on send.
   */
  references: string;
};

export class ThreadingResolver {
  constructor(private readonly db: Db) {}

  /**
   * Resolves the thread context to attach to the next `send_email` task.
   * Returns `null` when no previous thread is reachable for the requested
   * mode (legitimate for `new_thread` ; defensive fallback otherwise).
   */
  public async resolve(input: {
    enrolmentId: string;
    mode: ThreadingMode;
    organizationId: string;
    contactId: string;
  }): Promise<ThreadContext | null> {
    if (input.mode === "new_thread") return null;

    if (input.mode === "last_email_step") {
      return this.findLastEmailStepThread(input.enrolmentId);
    }
    if (input.mode === "entry_email_step") {
      return this.findEntryEmailStepThread(input.enrolmentId);
    }
    if (input.mode === "last_answered_step") {
      const answered = await this.findLastAnsweredStepThread(input);
      if (answered) return answered;
      // Defensive fallback to keep the send threaded somewhere visible.
      console.warn(
        "[ThreadingResolver] last_answered_step fallback to last_email_step (no inbound interaction)",
        { enrolmentId: input.enrolmentId },
      );
      return this.findLastEmailStepThread(input.enrolmentId);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Mode implementations
  // ---------------------------------------------------------------------------

  private async findLastEmailStepThread(
    enrolmentId: string,
  ): Promise<ThreadContext | null> {
    const row = await this.db.query.sequenceStepExecutions.findFirst({
      where: and(
        eq(sequenceStepExecutions.enrolmentId, enrolmentId),
        isNotNull(sequenceStepExecutions.mailThreadId),
        isNotNull(sequenceStepExecutions.mailMessageId),
      ),
      orderBy: [desc(sequenceStepExecutions.executedAt)],
      columns: {
        mailThreadId: true,
        mailMessageId: true,
        subject: true,
        executionCounter: true,
      },
    });
    return this.attachReferences(enrolmentId, row);
  }

  private async findEntryEmailStepThread(
    enrolmentId: string,
  ): Promise<ThreadContext | null> {
    const row = await this.db.query.sequenceStepExecutions.findFirst({
      where: and(
        eq(sequenceStepExecutions.enrolmentId, enrolmentId),
        isNotNull(sequenceStepExecutions.mailThreadId),
        isNotNull(sequenceStepExecutions.mailMessageId),
      ),
      orderBy: [asc(sequenceStepExecutions.executionCounter)],
      columns: {
        mailThreadId: true,
        mailMessageId: true,
        subject: true,
        executionCounter: true,
      },
    });
    return this.attachReferences(enrolmentId, row);
  }

  /**
   * `last_answered_step` — find the most recent inbound (`email_received`)
   * interaction for this contact whose underlying outbound message is
   * linked (via its task) to THIS enrolment. We then return the step
   * execution that owns the matching `gmail_thread_id` so the next send
   * lands as a real reply to the same outbound the contact answered.
   *
   * The query chain :
   *   interactions (type='email_received', contact=X)
   *     → messages (interactions.message_id → messages.id)
   *     → tasks   (messages.task_id → tasks.id, sequence_enrolment_id = enrolment)
   *
   * From that we read `messages.mailThreadId` and look up the
   * `sequence_step_executions` row whose thread matches.
   */
  private async findLastAnsweredStepThread(input: {
    enrolmentId: string;
    organizationId: string;
    contactId: string;
  }): Promise<ThreadContext | null> {
    const rows = await this.db
      .select({
        threadId: messages.mailThreadId,
      })
      .from(interactions)
      .innerJoin(messages, eq(messages.id, interactions.messageId))
      .innerJoin(tasks, eq(tasks.id, messages.taskId))
      .where(
        and(
          eq(interactions.organizationId, input.organizationId),
          eq(interactions.contactId, input.contactId),
          eq(interactions.type, "email_received"),
          eq(tasks.sequenceEnrolmentId, input.enrolmentId),
          isNotNull(messages.mailThreadId),
        ),
      )
      .orderBy(desc(interactions.occurredAt))
      .limit(1);

    const threadId = rows[0]?.threadId;
    if (!threadId) return null;

    return this.findExecutionByThreadId(input.enrolmentId, threadId);
  }

  /**
   * Find the step_execution in this enrolment whose `gmail_thread_id`
   * matches the one the contact replied into. Returns the most recent
   * matching row (multiple executions can share a thread when a step
   * later re-replied into the same conversation).
   */
  private async findExecutionByThreadId(
    enrolmentId: string,
    threadId: string,
  ): Promise<ThreadContext | null> {
    const row = await this.db.query.sequenceStepExecutions.findFirst({
      where: and(
        eq(sequenceStepExecutions.enrolmentId, enrolmentId),
        eq(sequenceStepExecutions.mailThreadId, threadId),
        isNotNull(sequenceStepExecutions.mailMessageId),
      ),
      orderBy: [desc(sequenceStepExecutions.executedAt)],
      columns: {
        mailThreadId: true,
        mailMessageId: true,
        subject: true,
        executionCounter: true,
      },
    });
    return this.attachReferences(enrolmentId, row);
  }

  // ---------------------------------------------------------------------------
  // References chain builder — RFC 5322 §3.6.4
  // ---------------------------------------------------------------------------

  /**
   * Builds the full ancestry chain of message-ids for the References header.
   * Includes every prior `sequence_step_executions` row of this enrolment
   * with a non-null `gmail_message_id` AND `execution_counter <= target`.
   * The parent (the row we just resolved as `replyToMessageId`) is part of
   * that set, so the chain naturally ends with the parent's id.
   *
   * Returns a space-separated list of bracket-wrapped ids, oldest → newest.
   */
  private async buildReferencesChain(
    enrolmentId: string,
    targetExecutionCounter: number,
  ): Promise<string> {
    const rows = await this.db
      .select({
        mailMessageId: sequenceStepExecutions.mailMessageId,
      })
      .from(sequenceStepExecutions)
      .where(
        and(
          eq(sequenceStepExecutions.enrolmentId, enrolmentId),
          isNotNull(sequenceStepExecutions.mailMessageId),
          lte(sequenceStepExecutions.executionCounter, targetExecutionCounter),
        ),
      )
      .orderBy(asc(sequenceStepExecutions.executionCounter));
    return rows
      .map((r) => r.mailMessageId)
      .filter((id): id is string => Boolean(id))
      .map(wrapAngles)
      .join(" ");
  }

  /**
   * Promotes a Drizzle row into a `ThreadContext` AND builds the References
   * chain for it. Returns null when the row is missing the bare-minimum
   * thread+message id (defensive — the partial index should prevent it).
   */
  private async attachReferences(
    enrolmentId: string,
    row:
      | {
          mailThreadId: string | null;
          mailMessageId: string | null;
          subject: string | null;
          executionCounter: number;
        }
      | null
      | undefined,
  ): Promise<ThreadContext | null> {
    if (!row || !row.mailThreadId || !row.mailMessageId) return null;
    const references = await this.buildReferencesChain(
      enrolmentId,
      row.executionCounter,
    );
    return {
      threadId: row.mailThreadId,
      replyToMessageId: row.mailMessageId,
      subject: row.subject ?? "",
      // Defensive : if the chain came back empty (shouldn't happen since
      // the target row itself is in the set), fall back to the parent id
      // alone so the header is still well-formed.
      references: references || wrapAngles(row.mailMessageId),
    };
  }
}

/**
 * Defensive helper — Gmail returns message ids without angle brackets from
 * the v1 API, but RFC 5322 References/In-Reply-To headers require them.
 * Idempotent so we can call it on already-bracketed ids without doubling.
 */
function wrapAngles(id: string): string {
  return /^<.+>$/.test(id) ? id : `<${id}>`;
}

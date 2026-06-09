import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  sequences,
  sequenceSteps,
  sequenceEnrolments,
  sequenceStepExecutions,
} from "@/db/schema";
import type {
  SequenceStepActionConfig,
  SequenceStepActionType,
  NextStepIds,
  SequencePredicate,
} from "@/lib/sequences/types";

/**
 * Query helpers for the sequence definition tables (`sequences` + `sequence_steps`).
 *
 * Every helper takes an explicit `db: DbOrTx` so the caller chooses the pool:
 * UI/actions pass `getDb()` (RLS-bound) ; the Inngest engine passes
 * `getAdminDb()` (trusted job, RLS bypassed). All reads/writes are still
 * scoped by `organizationId` for defense in depth.
 */

export type SequenceStepRow = {
  id: string;
  sequenceId: string;
  stepOrder: number;
  actionType: SequenceStepActionType;
  actionConfig: SequenceStepActionConfig;
  nextStepIds: NextStepIds;
  condition: SequencePredicate;
  filter: SequencePredicate;
  /**
   * Slice D — per-step override of the sequence's `unknownOutcomeStrategy`.
   * `null` = inherit the sequence-level value. Plain text (not enum) so the
   * runtime defends with `resolveUnknownOutcomeStrategy()` against any
   * unexpected value rather than crashing.
   */
  unknownOutcomeStrategy: string | null;
};

// ---------------------------------------------------------------------------
// Sequences — reads
// ---------------------------------------------------------------------------

/** Single sequence for the org, or undefined. Excludes soft-deleted. */
export async function getSequenceById(db: DbOrTx, orgId: string, id: string) {
  return db.query.sequences.findFirst({
    where: and(
      eq(sequences.organizationId, orgId),
      eq(sequences.id, id),
      isNull(sequences.deletedAt),
    ),
  });
}

/** Sequence + its steps ordered by stepOrder. Undefined if not found. */
export async function getSequenceWithSteps(db: DbOrTx, orgId: string, id: string) {
  const sequence = await getSequenceById(db, orgId, id);
  if (!sequence) return undefined;
  const steps = await getStepsForSequence(db, id);
  return { sequence, steps };
}

/**
 * Index list : every non-deleted sequence for the org with its active-enrolment
 * count, newest first.
 */
export async function listSequencesWithCounts(db: DbOrTx, orgId: string) {
  const activeCount = db
    .select({
      sequenceId: sequenceEnrolments.sequenceId,
      count: sql<number>`count(*)::int`.as("active_count"),
    })
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        sql`${sequenceEnrolments.status} in ('active','paused')`,
      ),
    )
    .groupBy(sequenceEnrolments.sequenceId)
    .as("active_count");

  return db
    .select({
      id: sequences.id,
      name: sequences.name,
      description: sequences.description,
      isActive: sequences.isActive,
      hasDraft: sql<boolean>`${sequences.draftDefinition} is not null`,
      editingLockedBy: sequences.editingLockedBy,
      editingLockedAt: sequences.editingLockedAt,
      updatedAt: sequences.updatedAt,
      activeEnrolments: sql<number>`coalesce(${activeCount.count}, 0)`,
    })
    .from(sequences)
    .leftJoin(activeCount, eq(activeCount.sequenceId, sequences.id))
    .where(and(eq(sequences.organizationId, orgId), isNull(sequences.deletedAt)))
    .orderBy(sql`${sequences.updatedAt} desc`);
}

/**
 * Active, published, non-deleted sequences for the org — the candidate set for
 * eligibility matching when auto-enrolling a contact.
 */
export async function getActiveSequencesForTargeting(db: DbOrTx, orgId: string) {
  return db.query.sequences.findMany({
    where: and(
      eq(sequences.organizationId, orgId),
      eq(sequences.isActive, true),
      isNull(sequences.deletedAt),
    ),
  });
}

// ---------------------------------------------------------------------------
// Steps — reads
// ---------------------------------------------------------------------------

export async function getStepsForSequence(db: DbOrTx, sequenceId: string): Promise<SequenceStepRow[]> {
  const rows = await db
    .select({
      id: sequenceSteps.id,
      sequenceId: sequenceSteps.sequenceId,
      stepOrder: sequenceSteps.stepOrder,
      actionType: sequenceSteps.actionType,
      actionConfig: sequenceSteps.actionConfig,
      nextStepIds: sequenceSteps.nextStepIds,
      condition: sequenceSteps.condition,
      filter: sequenceSteps.filter,
      unknownOutcomeStrategy: sequenceSteps.unknownOutcomeStrategy,
    })
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(sequenceSteps.stepOrder));

  return rows.map((r) => ({
    ...r,
    actionType: r.actionType as SequenceStepActionType,
    actionConfig: (r.actionConfig ?? {}) as SequenceStepActionConfig,
    nextStepIds: (r.nextStepIds ?? null) as NextStepIds,
    condition: (r.condition ?? null) as SequencePredicate,
    filter: (r.filter ?? null) as SequencePredicate,
  }));
}

/** Single step (used by the engine to load the current step of an enrolment). */
export async function getStepById(db: DbOrTx, stepId: string): Promise<SequenceStepRow | undefined> {
  const [r] = await db
    .select({
      id: sequenceSteps.id,
      sequenceId: sequenceSteps.sequenceId,
      stepOrder: sequenceSteps.stepOrder,
      actionType: sequenceSteps.actionType,
      actionConfig: sequenceSteps.actionConfig,
      nextStepIds: sequenceSteps.nextStepIds,
      condition: sequenceSteps.condition,
      filter: sequenceSteps.filter,
      unknownOutcomeStrategy: sequenceSteps.unknownOutcomeStrategy,
    })
    .from(sequenceSteps)
    .where(eq(sequenceSteps.id, stepId))
    .limit(1);
  if (!r) return undefined;
  return {
    ...r,
    actionType: r.actionType as SequenceStepActionType,
    actionConfig: (r.actionConfig ?? {}) as SequenceStepActionConfig,
    nextStepIds: (r.nextStepIds ?? null) as NextStepIds,
    condition: (r.condition ?? null) as SequencePredicate,
    filter: (r.filter ?? null) as SequencePredicate,
  };
}

// ---------------------------------------------------------------------------
// Sequences — writes
// ---------------------------------------------------------------------------

export type InsertSequenceInput = {
  name: string;
  description?: string | null;
  isActive?: boolean;
  targetRelationshipTypes?: string[];
  targetSiteTypes?: string[];
  targetContactRoles?: string[];
  targetLocales?: string[];
  excludeIfCompanyHasActiveSequence?: boolean;
  excludeIfCompanyRelationshipIn?: string[];
  cooldownAfterCompletedDays?: number | null;
  /** Slice D — defaults to 'park' on insert when omitted. */
  unknownOutcomeStrategy?: string;
  /** Sprint 12 — defaults to 'sequence' on insert when omitted. */
  messageContextScope?: string;
  draftDefinition?: unknown;
};

export async function insertSequence(db: DbOrTx, orgId: string, input: InsertSequenceInput) {
  const [row] = await db
    .insert(sequences)
    .values({
      organizationId: orgId,
      name: input.name,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
      targetRelationshipTypes: input.targetRelationshipTypes ?? [],
      targetSiteTypes: input.targetSiteTypes ?? [],
      targetContactRoles: input.targetContactRoles ?? [],
      targetLocales: input.targetLocales ?? [],
      excludeIfCompanyHasActiveSequence: input.excludeIfCompanyHasActiveSequence ?? true,
      excludeIfCompanyRelationshipIn: input.excludeIfCompanyRelationshipIn ?? [],
      cooldownAfterCompletedDays: input.cooldownAfterCompletedDays ?? null,
      draftDefinition: input.draftDefinition ?? null,
    })
    .returning({ id: sequences.id });
  if (!row) throw new Error("insertSequence: no row returned");
  return row;
}

/**
 * Sprint 12 — when generating an AI message from a task that comes from
 * a sequence, the dialog / action needs to know the effective
 * `messageContextScope` for that task. Resolves the (sequence, source
 * step) pair via the existing chain :
 *
 *   tasks.id → sequence_step_executions.taskId → stepId → step + sequence
 *
 * Returns null if the task isn't sequence-driven (or the chain is broken
 * after a publish swap — the caller falls back to the legacy full history).
 */
export async function getMessageContextResolutionForTask(
  db: DbOrTx,
  taskId: string,
): Promise<{
  sequenceEnrolmentId: string;
  sequenceScope: string | null;
  stepScope: string | null;
  /**
   * Sprint 12 — full action config of the source step, so the message
   * generator can fall back on the step's `orientation` (and any other
   * AI-mode field) when the dialog didn't override it. Stays untyped
   * here (the action layer narrows when reading) so we keep the query
   * fully reusable.
   */
  stepActionConfig: Record<string, unknown> | null;
} | null> {
  // First : pull the step_execution row (no joins). step_executions is
  // a soft reference to sequence_steps — we have to resolve manually so
  // we can fall back by step_order when the step row's id has drifted
  // after a sequence republish (same drift as the engine handles in
  // sequence-engine.ts:96-98 and the diagram resolver in the enrolment
  // page). Without the fallback, agent auto-execution dies with
  // "Source step config not found" the moment anyone publishes the
  // sequence between enrolment and task execution.
  const [exec] = await db
    .select({
      enrolmentId: sequenceStepExecutions.enrolmentId,
      stepId: sequenceStepExecutions.stepId,
      stepOrder: sequenceStepExecutions.stepOrder,
    })
    .from(sequenceStepExecutions)
    .where(eq(sequenceStepExecutions.taskId, taskId))
    .limit(1);
  if (!exec) return null;

  // Need the enrolment's sequence_id for the fallback lookup + the
  // sequence-level scope. Single small query.
  const [enrolmentRow] = await db
    .select({ sequenceId: sequenceEnrolments.sequenceId })
    .from(sequenceEnrolments)
    .where(eq(sequenceEnrolments.id, exec.enrolmentId))
    .limit(1);
  if (!enrolmentRow) return null;

  // Resolve the live step : id first (still around → no republish since
  // enrolment), then fall back to step_order within the same sequence
  // (republish recreated the rows under fresh UUIDs).
  let stepRow = await db
    .select({
      messageContextScope: sequenceSteps.messageContextScope,
      actionConfig: sequenceSteps.actionConfig,
    })
    .from(sequenceSteps)
    .where(eq(sequenceSteps.id, exec.stepId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!stepRow) {
    stepRow = await db
      .select({
        messageContextScope: sequenceSteps.messageContextScope,
        actionConfig: sequenceSteps.actionConfig,
      })
      .from(sequenceSteps)
      .where(
        and(
          eq(sequenceSteps.sequenceId, enrolmentRow.sequenceId),
          eq(sequenceSteps.stepOrder, exec.stepOrder),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
  }
  if (!stepRow) return null;

  const [sequenceRow] = await db
    .select({ messageContextScope: sequences.messageContextScope })
    .from(sequences)
    .where(eq(sequences.id, enrolmentRow.sequenceId))
    .limit(1);

  return {
    sequenceEnrolmentId: exec.enrolmentId,
    sequenceScope: sequenceRow?.messageContextScope ?? null,
    stepScope: stepRow.messageContextScope,
    stepActionConfig:
      (stepRow.actionConfig as Record<string, unknown> | null) ?? null,
  };
}

export type UpdateSequenceMetaInput = Partial<
  Omit<InsertSequenceInput, "draftDefinition">
>;

export async function updateSequenceMeta(
  db: DbOrTx,
  orgId: string,
  id: string,
  patch: UpdateSequenceMetaInput,
) {
  await db
    .update(sequences)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

export async function setSequenceActive(db: DbOrTx, orgId: string, id: string, isActive: boolean) {
  await db
    .update(sequences)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

export async function softDeleteSequence(db: DbOrTx, orgId: string, id: string) {
  await db
    .update(sequences)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

export async function setSequenceDraft(
  db: DbOrTx,
  orgId: string,
  id: string,
  draftDefinition: unknown,
  draftSavedAt: Date,
) {
  await db
    .update(sequences)
    .set({ draftDefinition, draftSavedAt, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

export async function clearSequenceDraft(db: DbOrTx, orgId: string, id: string) {
  await db
    .update(sequences)
    .set({ draftDefinition: null, draftSavedAt: null, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

// ---------------------------------------------------------------------------
// Editing lock
// ---------------------------------------------------------------------------

export async function setEditingLock(db: DbOrTx, orgId: string, id: string, userId: string, at: Date) {
  await db
    .update(sequences)
    .set({ editingLockedBy: userId, editingLockedAt: at, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

export async function clearEditingLock(db: DbOrTx, orgId: string, id: string) {
  await db
    .update(sequences)
    .set({ editingLockedBy: null, editingLockedAt: null, updatedAt: new Date() })
    .where(and(eq(sequences.organizationId, orgId), eq(sequences.id, id)));
}

// ---------------------------------------------------------------------------
// Steps — writes (publish replaces the whole step set atomically)
// ---------------------------------------------------------------------------

export type PublishStepRow = {
  id: string; // pre-generated UUID so nextStepIds can cross-reference
  stepOrder: number;
  actionType: SequenceStepActionType;
  actionConfig: SequenceStepActionConfig;
  nextStepIds: NextStepIds;
  condition: SequencePredicate;
  filter: SequencePredicate;
};

export async function deleteStepsForSequence(db: DbOrTx, sequenceId: string) {
  await db.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId));
}

export async function insertSteps(db: DbOrTx, sequenceId: string, rows: PublishStepRow[]) {
  if (rows.length === 0) return;
  await db.insert(sequenceSteps).values(
    rows.map((r) => ({
      id: r.id,
      sequenceId,
      stepOrder: r.stepOrder,
      actionType: r.actionType,
      actionConfig: r.actionConfig,
      nextStepIds: r.nextStepIds,
      condition: r.condition,
      filter: r.filter,
    })),
  );
}

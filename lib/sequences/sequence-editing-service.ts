import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import {
  getSequenceById,
  getStepsForSequence,
  setEditingLock,
  clearEditingLock,
  setSequenceDraft,
  clearSequenceDraft,
  deleteStepsForSequence,
  insertSteps,
  getActiveSequencesForTargeting,
  type PublishStepRow,
} from "@/db/queries/sequences";
import { sequenceEnrolments } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  draftDefinitionSchema,
  validateDraftGraph,
  type DraftDefinition,
  type DraftStep,
} from "./draft-schema";
import type { NextStepIds, SequenceStepActionConfig } from "./types";
import {
  SequenceNotFoundError,
  SequenceLockedError,
  SequenceDraftInvalidError,
  SequenceNoDraftError,
} from "@/lib/actions/sequence-action-errors";
import { collectAttachmentPathsFromSteps } from "./step-attachments";
import { getAttachmentStorageService } from "@/lib/gmail/attachment-storage-service";

const STEP_ATTACHMENT_BUCKET = "message-attachments";

/** Default idle timeout after which another user may take over the lock. */
const DEFAULT_LOCK_TTL_MS = 30 * 60_000;

export type PublishImpact = {
  /** Active/paused enrolments whose cursor still maps to a step. */
  unaffected: number;
  /** Active enrolments whose cursor overshoots the new step count — they
   *  will end as completed_exhausted on their next tick. */
  endingExhaustedAfterPublish: number;
};

/**
 * Owns the draft → publish → lock lifecycle for a sequence.
 *
 * The engine NEVER reads `draft_definition` — it runs the published
 * `sequence_steps`. This service is the only writer of that table for the
 * editing flow, and it does the publish as a single transaction so the swap
 * is atomic. Constructor-injected `db` + `now` keep it testable.
 *
 * Lock model : optimistic single-editor. `editing_locked_by/at` on the
 * sequence row ; a lock older than `lockTtlMs` is considered stale and can be
 * taken over. `saveDraft` refreshes the heartbeat.
 */
export class SequenceEditingService {
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly lockTtlMs: number;

  constructor(deps: { db: Db; now?: () => Date; lockTtlMs?: number }) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
    this.lockTtlMs = deps.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  // -------------------------------------------------------------------------
  // Lock
  // -------------------------------------------------------------------------

  /** Acquire (or refresh) the lock for `userId`. Throws if held + fresh by another. */
  async startEditing(orgId: string, sequenceId: string, userId: string): Promise<{ lockedAt: Date }> {
    const seq = await getSequenceById(this.db, orgId, sequenceId);
    if (!seq) throw new SequenceNotFoundError(sequenceId);
    this.assertLockAvailable(seq.editingLockedBy, seq.editingLockedAt, userId);
    const now = this.now();
    await setEditingLock(this.db, orgId, sequenceId, userId, now);
    return { lockedAt: now };
  }

  /** Release the lock if `userId` holds it (idempotent ; `force` overrides). */
  async releaseLock(
    orgId: string,
    sequenceId: string,
    userId: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const seq = await getSequenceById(this.db, orgId, sequenceId);
    if (!seq) throw new SequenceNotFoundError(sequenceId);
    if (!opts.force && seq.editingLockedBy && seq.editingLockedBy !== userId) {
      // Not the holder and no force — leave the lock alone.
      return;
    }
    await clearEditingLock(this.db, orgId, sequenceId);
  }

  // -------------------------------------------------------------------------
  // Draft
  // -------------------------------------------------------------------------

  /** Validate the draft shape, store it, and refresh the lock heartbeat. */
  async saveDraft(
    orgId: string,
    sequenceId: string,
    userId: string,
    rawDraft: unknown,
  ): Promise<{ savedAt: Date }> {
    const seq = await getSequenceById(this.db, orgId, sequenceId);
    if (!seq) throw new SequenceNotFoundError(sequenceId);
    this.assertLockAvailable(seq.editingLockedBy, seq.editingLockedAt, userId);

    const parsed = draftDefinitionSchema.safeParse(rawDraft);
    if (!parsed.success) {
      throw new SequenceDraftInvalidError(parsed.error.issues[0]?.message ?? "schema");
    }

    const now = this.now();
    // Persist draft + refresh the lock heartbeat in one shot.
    await setSequenceDraft(this.db, orgId, sequenceId, parsed.data, now);
    await setEditingLock(this.db, orgId, sequenceId, userId, now);
    return { savedAt: now };
  }

  /** Discard the pending draft and release the lock. */
  async discardDraft(orgId: string, sequenceId: string, userId: string): Promise<void> {
    const seq = await getSequenceById(this.db, orgId, sequenceId);
    if (!seq) throw new SequenceNotFoundError(sequenceId);
    this.assertLockAvailable(seq.editingLockedBy, seq.editingLockedAt, userId);

    // Sprint 12 — clean step attachments that were uploaded into the draft
    // and never published. We diff the draft's attachment paths against
    // the published step rows ; anything present in the draft but not
    // in production is an orphan we can safely remove from Storage.
    const orphans = await this.computeDraftOrphanAttachmentPaths(
      sequenceId,
      seq.draftDefinition,
    );
    await this.removeStorageObjectsQuietly(orphans);

    await clearSequenceDraft(this.db, orgId, sequenceId);
    await clearEditingLock(this.db, orgId, sequenceId);
  }

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  /**
   * Validate the stored draft fully (shape + graph + enroll-target existence),
   * remap author step ids to UUIDs, then atomically replace `sequence_steps`,
   * clear the draft, and release the lock. Returns the new step count.
   */
  async publishDraft(
    orgId: string,
    sequenceId: string,
    userId: string,
  ): Promise<{ stepCount: number }> {
    const seq = await getSequenceById(this.db, orgId, sequenceId);
    if (!seq) throw new SequenceNotFoundError(sequenceId);
    this.assertLockAvailable(seq.editingLockedBy, seq.editingLockedAt, userId);
    if (seq.draftDefinition == null) throw new SequenceNoDraftError();

    const draft = this.validateForPublish(seq.draftDefinition);
    await this.assertEnrollTargetsExist(orgId, sequenceId, draft);

    const rows = this.remapToStepRows(draft);

    // Sprint 12 — compute attachments that disappear on publish (= they
    // were in the previously-published step set but not in the new draft).
    // Done BEFORE the transaction so a Storage failure doesn't roll back
    // the publish — Storage cleanup is best-effort, never blocking.
    const published = await getStepsForSequence(this.db, sequenceId);
    const publishedPaths = collectAttachmentPathsFromSteps(published);
    const newPaths = collectAttachmentPathsFromSteps(rows);
    const removed = this.diffPathsLeftOnly(publishedPaths, newPaths);

    await this.db.transaction(async (tx) => {
      await deleteStepsForSequence(tx, sequenceId);
      await insertSteps(tx, sequenceId, rows);
      await clearSequenceDraft(tx, orgId, sequenceId);
      await clearEditingLock(tx, orgId, sequenceId);
    });

    // Cleanup after the commit succeeds — orphan files in Storage now
    // that no published step references them.
    await this.removeStorageObjectsQuietly(removed);

    return { stepCount: rows.length };
  }

  /**
   * Count active/paused enrolments that would overshoot the new step count.
   * Used by the publish-impact preview modal — read-only, no mutation.
   */
  async previewPublishImpact(orgId: string, sequenceId: string): Promise<PublishImpact> {
    const seq = await getSequenceById(this.db, orgId, sequenceId);
    if (!seq) throw new SequenceNotFoundError(sequenceId);
    const newStepCount = seq.draftDefinition
      ? this.safeStepCount(seq.draftDefinition)
      : (await getStepsForSequence(this.db, sequenceId)).length;

    const [row] = await this.db
      .select({
        overshoot: sql<number>`count(*) filter (where ${sequenceEnrolments.currentStepOrder} >= ${newStepCount})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(sequenceEnrolments)
      .where(
        and(
          eq(sequenceEnrolments.organizationId, orgId),
          eq(sequenceEnrolments.sequenceId, sequenceId),
          sql`${sequenceEnrolments.status} in ('active','paused')`,
        ),
      );

    const overshoot = row?.overshoot ?? 0;
    const total = row?.total ?? 0;
    return { unaffected: total - overshoot, endingExhaustedAfterPublish: overshoot };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertLockAvailable(
    lockedBy: string | null,
    lockedAt: Date | null,
    userId: string,
  ): void {
    if (!lockedBy || lockedBy === userId) return;
    const fresh = lockedAt != null && this.now().getTime() - lockedAt.getTime() < this.lockTtlMs;
    if (fresh) throw new SequenceLockedError(lockedBy);
    // Stale lock — caller may take over.
  }

  private validateForPublish(rawDraft: unknown): DraftDefinition {
    const parsed = draftDefinitionSchema.safeParse(rawDraft);
    if (!parsed.success) {
      throw new SequenceDraftInvalidError(parsed.error.issues[0]?.message ?? "schema");
    }
    const issues = validateDraftGraph(parsed.data);
    if (issues.length > 0) {
      const first = issues[0]!;
      throw new SequenceDraftInvalidError(
        first.stepId ? `${first.code}@${first.stepId}` : first.code,
      );
    }
    return parsed.data;
  }

  private safeStepCount(rawDraft: unknown): number {
    const parsed = draftDefinitionSchema.safeParse(rawDraft);
    return parsed.success ? parsed.data.steps.length : 0;
  }

  /**
   * Sprint 12 — orphan attachment computation for `discardDraft`.
   * Reads the draft (untyped — we don't want to fail discard if the
   * schema is borderline) AND the currently published step set, then
   * keeps the paths present in the draft but absent from production.
   * These are the files that were uploaded into the draft and never
   * survived a publish.
   */
  private async computeDraftOrphanAttachmentPaths(
    sequenceId: string,
    rawDraft: unknown,
  ): Promise<string[]> {
    if (rawDraft == null || typeof rawDraft !== "object") return [];
    const draftSteps = (rawDraft as { steps?: unknown }).steps;
    if (!Array.isArray(draftSteps)) return [];
    const draftPaths = collectAttachmentPathsFromSteps(
      draftSteps as Array<{ actionConfig?: unknown }>,
    );
    if (draftPaths.length === 0) return [];

    const published = await getStepsForSequence(this.db, sequenceId);
    const publishedPaths = new Set(collectAttachmentPathsFromSteps(published));
    return draftPaths.filter((p) => !publishedPaths.has(p));
  }

  /** Same diff helper used by publishDraft — `left - right` by path. */
  private diffPathsLeftOnly(left: readonly string[], right: readonly string[]): string[] {
    const r = new Set(right);
    return left.filter((p) => !r.has(p));
  }

  /**
   * Best-effort removal of Storage objects. Storage failures must NEVER
   * roll back the underlying sequence edit — at worst we leak a file,
   * which is harmless from a correctness standpoint. Logged so we can
   * spot pattern failures in production.
   */
  private async removeStorageObjectsQuietly(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const storage = getAttachmentStorageService();
    await Promise.all(
      paths.map((p) =>
        storage.deleteQuietly(STEP_ATTACHMENT_BUCKET, p).catch((err) => {
          console.error("[sequence-editing-service] storage delete failed", {
            path: p,
            err: err instanceof Error ? err.message : String(err),
          });
        }),
      ),
    );
  }

  /**
   * `enroll_in_sequence` targets must reference an active, published sequence
   * in the same org. Validated here (not in the pure graph validator, which
   * has no DB access).
   */
  private async assertEnrollTargetsExist(
    orgId: string,
    sequenceId: string,
    draft: DraftDefinition,
  ): Promise<void> {
    const targets = draft.steps
      .filter((s) => s.actionType === "enroll_in_sequence")
      .map((s) => (s.actionConfig as { targetSequenceId?: string }).targetSequenceId)
      .filter((v): v is string => Boolean(v));

    if (targets.length === 0) return;

    const active = await getActiveSequencesForTargeting(this.db, orgId);
    const activeIds = new Set(active.map((s) => s.id));
    for (const target of targets) {
      // A sequence may cascade into itself only if it is (will be) active.
      if (target !== sequenceId && !activeIds.has(target)) {
        throw new SequenceDraftInvalidError(`enroll_target_not_found:${target}`);
      }
    }
  }

  private remapToStepRows(draft: DraftDefinition): PublishStepRow[] {
    const idMap = new Map<string, string>();
    for (const step of draft.steps) idMap.set(step.id, randomUUID());

    const remapNext = (next: NextStepIds): NextStepIds => {
      if (!next) return null;
      const out: NonNullable<NextStepIds> = {};
      if (next.default) out.default = idMap.get(next.default) ?? next.default;
      if (next.yes) out.yes = idMap.get(next.yes) ?? next.yes;
      if (next.no) out.no = idMap.get(next.no) ?? next.no;
      if (next.cases) {
        out.cases = Object.fromEntries(
          Object.entries(next.cases).map(([k, v]) => [k, idMap.get(v) ?? v]),
        );
      }
      return out;
    };

    // Linearise the DAG into a unique step_order. In the graph model navigation
    // is id-based (next_step_ids), so step_order is vestigial — but the table
    // keeps a unique (sequence_id, step_order) index and the enrolment/overshoot
    // logic reads it. Branch steps can share the same authoring order, so we
    // reassign deterministically: entry = 0, then breadth-first along the
    // default/yes/no/cases edges. Entry-first keeps draft-from-steps (which
    // infers the entry as the lowest order) correct on the next reload.
    const stepById = new Map(draft.steps.map((s) => [s.id, s]));
    const orderById = new Map<string, number>();
    const queue: string[] = stepById.has(draft.entryStepId) ? [draft.entryStepId] : [];
    let nextOrder = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (orderById.has(id)) continue;
      orderById.set(id, nextOrder++);
      const next = stepById.get(id)?.nextStepIds;
      if (!next) continue;
      const targets = [
        next.default,
        next.yes,
        next.no,
        ...(next.cases ? Object.values(next.cases) : []),
      ];
      for (const tid of targets) {
        if (tid && stepById.has(tid) && !orderById.has(tid)) queue.push(tid);
      }
    }
    // Any step unreachable from the entry still needs a unique order.
    for (const step of draft.steps) {
      if (!orderById.has(step.id)) orderById.set(step.id, nextOrder++);
    }

    return draft.steps
      .slice()
      .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)
      .map((step: DraftStep) => ({
        id: idMap.get(step.id)!,
        stepOrder: orderById.get(step.id)!,
        actionConfig: step.actionConfig as SequenceStepActionConfig,
        actionType: step.actionType,
        nextStepIds: remapNext(step.nextStepIds),
        condition: step.condition,
        filter: step.filter,
      }));
  }
}

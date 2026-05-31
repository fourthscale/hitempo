import "server-only";
import { and, desc, eq, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { sequenceEnrolments, sequences, contacts, companies } from "@/db/schema";
import type { SequenceEndReason } from "@/lib/sequences/types";

/**
 * Query helpers for `sequence_enrolments`. As with sequences.ts, every helper
 * takes an explicit `db: DbOrTx` so the UI passes the RLS pool and the engine
 * passes the admin pool. Org-scoping is still applied for defense in depth
 * (except the cross-org engine sweep `getDueEnrolments`, which the trusted
 * cron uses to process every tenant).
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getEnrolmentById(db: DbOrTx, orgId: string, id: string) {
  return db.query.sequenceEnrolments.findFirst({
    where: and(
      eq(sequenceEnrolments.organizationId, orgId),
      eq(sequenceEnrolments.id, id),
    ),
  });
}

/**
 * Rich variant used by the enrolment detail page : enrolment + contact +
 * company + sequence (name only — steps are loaded separately by the page so
 * the published step set can be rendered through the same draft graph used by
 * the editor).
 */
export async function getEnrolmentDetail(db: DbOrTx, orgId: string, id: string) {
  return db
    .select({
      id: sequenceEnrolments.id,
      sequenceId: sequenceEnrolments.sequenceId,
      sequenceName: sequences.name,
      contactId: sequenceEnrolments.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactKind: contacts.kind,
      contactEmail: contacts.email,
      companyId: sequenceEnrolments.companyId,
      companyName: companies.name,
      assigneeId: sequenceEnrolments.assigneeId,
      status: sequenceEnrolments.status,
      currentStepId: sequenceEnrolments.currentStepId,
      currentStepOrder: sequenceEnrolments.currentStepOrder,
      nextDueAt: sequenceEnrolments.nextDueAt,
      lastExecutionCounter: sequenceEnrolments.lastExecutionCounter,
      maxExecutionCount: sequenceEnrolments.maxExecutionCount,
      startedAt: sequenceEnrolments.startedAt,
      endedAt: sequenceEnrolments.endedAt,
      endReason: sequenceEnrolments.endReason,
    })
    .from(sequenceEnrolments)
    .innerJoin(sequences, eq(sequences.id, sequenceEnrolments.sequenceId))
    .innerJoin(contacts, eq(contacts.id, sequenceEnrolments.contactId))
    .innerJoin(companies, eq(companies.id, sequenceEnrolments.companyId))
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.id, id),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Engine sweep : every active enrolment whose `next_due_at` has passed, oldest
 * first. Cross-org by design (trusted cron). The engine claims each row inside
 * a transaction with its own status re-check, so a small over-fetch is safe.
 */
export async function getDueEnrolments(db: DbOrTx, now: Date, limit = 100) {
  return db
    .select({
      id: sequenceEnrolments.id,
      organizationId: sequenceEnrolments.organizationId,
      sequenceId: sequenceEnrolments.sequenceId,
      companyId: sequenceEnrolments.companyId,
      contactId: sequenceEnrolments.contactId,
      assigneeId: sequenceEnrolments.assigneeId,
      currentStepId: sequenceEnrolments.currentStepId,
      currentStepOrder: sequenceEnrolments.currentStepOrder,
      lastExecutionCounter: sequenceEnrolments.lastExecutionCounter,
      maxExecutionCount: sequenceEnrolments.maxExecutionCount,
      nextDueAt: sequenceEnrolments.nextDueAt,
    })
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.status, "active"),
        // NULL = "indefinite wait" (set after a human-action step). The
        // `IS NOT NULL` guard makes the planner skip them ; advancement comes
        // from the `sequences/task.completed` event in that case.
        isNotNull(sequenceEnrolments.nextDueAt),
        lte(sequenceEnrolments.nextDueAt, now),
      ),
    )
    .orderBy(sequenceEnrolments.nextDueAt)
    .limit(limit);
}

/** Enrolments (active + historical) for a contact, newest first. */
export async function listEnrolmentsForContact(db: DbOrTx, orgId: string, contactId: string) {
  return db
    .select({
      id: sequenceEnrolments.id,
      sequenceId: sequenceEnrolments.sequenceId,
      sequenceName: sequences.name,
      status: sequenceEnrolments.status,
      currentStepOrder: sequenceEnrolments.currentStepOrder,
      nextDueAt: sequenceEnrolments.nextDueAt,
      startedAt: sequenceEnrolments.startedAt,
      endedAt: sequenceEnrolments.endedAt,
      endReason: sequenceEnrolments.endReason,
    })
    .from(sequenceEnrolments)
    .innerJoin(sequences, eq(sequences.id, sequenceEnrolments.sequenceId))
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.contactId, contactId),
      ),
    )
    .orderBy(desc(sequenceEnrolments.startedAt));
}

/** Active enrolments for a company (any contact), with contact + sequence names. */
export async function listActiveEnrolmentsForCompany(db: DbOrTx, orgId: string, companyId: string) {
  return db
    .select({
      id: sequenceEnrolments.id,
      sequenceId: sequenceEnrolments.sequenceId,
      sequenceName: sequences.name,
      contactId: sequenceEnrolments.contactId,
      status: sequenceEnrolments.status,
      currentStepOrder: sequenceEnrolments.currentStepOrder,
      nextDueAt: sequenceEnrolments.nextDueAt,
    })
    .from(sequenceEnrolments)
    .innerJoin(sequences, eq(sequences.id, sequenceEnrolments.sequenceId))
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.companyId, companyId),
        sql`${sequenceEnrolments.status} in ('active','paused')`,
      ),
    )
    .orderBy(desc(sequenceEnrolments.startedAt));
}

/** Enrolments for a sequence (any status), newest first, with contact names. */
export async function listEnrolmentsForSequence(db: DbOrTx, orgId: string, sequenceId: string) {
  return db
    .select({
      id: sequenceEnrolments.id,
      contactId: sequenceEnrolments.contactId,
      companyId: sequenceEnrolments.companyId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactKind: contacts.kind,
      companyName: companies.name,
      status: sequenceEnrolments.status,
      currentStepOrder: sequenceEnrolments.currentStepOrder,
      nextDueAt: sequenceEnrolments.nextDueAt,
      startedAt: sequenceEnrolments.startedAt,
      endedAt: sequenceEnrolments.endedAt,
      endReason: sequenceEnrolments.endReason,
    })
    .from(sequenceEnrolments)
    .innerJoin(contacts, eq(contacts.id, sequenceEnrolments.contactId))
    .innerJoin(companies, eq(companies.id, sequenceEnrolments.companyId))
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.sequenceId, sequenceId),
      ),
    )
    .orderBy(desc(sequenceEnrolments.startedAt))
    .limit(200);
}

// ---------------------------------------------------------------------------
// Eligibility fact loaders (consumed by SequenceEligibilityChecker)
// ---------------------------------------------------------------------------

/** True if the contact has an active/paused enrolment in ANY sequence. */
export async function contactHasActiveEnrolment(db: DbOrTx, orgId: string, contactId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.contactId, contactId),
        sql`${sequenceEnrolments.status} in ('active','paused')`,
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * True if any contact at the company (optionally excluding one) has an
 * active/paused enrolment.
 */
export async function companyHasActiveEnrolment(
  db: DbOrTx,
  orgId: string,
  companyId: string,
  excludeContactId?: string,
) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.companyId, companyId),
        sql`${sequenceEnrolments.status} in ('active','paused')`,
        excludeContactId ? ne(sequenceEnrolments.contactId, excludeContactId) : undefined,
      ),
    );
  return (row?.n ?? 0) > 0;
}

/** When the contact most recently completed an enrolment, or null. */
export async function mostRecentCompletedEnrolmentAt(
  db: DbOrTx,
  orgId: string,
  contactId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ endedAt: sequenceEnrolments.endedAt })
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.contactId, contactId),
        sql`${sequenceEnrolments.endedAt} is not null`,
      ),
    )
    .orderBy(desc(sequenceEnrolments.endedAt))
    .limit(1);
  return row?.endedAt ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type InsertEnrolmentInput = {
  sequenceId: string;
  companyId: string;
  contactId: string;
  assigneeId: string | null;
  currentStepId: string;
  currentStepOrder: number;
  nextDueAt: Date;
  maxExecutionCount?: number;
};

export async function insertEnrolment(db: DbOrTx, orgId: string, input: InsertEnrolmentInput) {
  const [row] = await db
    .insert(sequenceEnrolments)
    .values({
      organizationId: orgId,
      sequenceId: input.sequenceId,
      companyId: input.companyId,
      contactId: input.contactId,
      assigneeId: input.assigneeId,
      status: "active",
      currentStepId: input.currentStepId,
      currentStepOrder: input.currentStepOrder,
      nextDueAt: input.nextDueAt,
      maxExecutionCount: input.maxExecutionCount ?? 200,
    })
    .returning({ id: sequenceEnrolments.id });
  if (!row) throw new Error("insertEnrolment: no row returned");
  return row;
}

/**
 * Advance an enrolment to the next step + schedule, bumping the loop counter.
 * Pass `nextDueAt: null` to put the enrolment into the indefinite-wait state
 * (used after a human-action step — the `sequences/task.completed` event
 * supplies the wake-up).
 */
export async function advanceEnrolment(
  db: DbOrTx,
  enrolmentId: string,
  patch: {
    currentStepId: string;
    currentStepOrder: number;
    nextDueAt: Date | null;
    lastExecutionCounter: number;
  },
) {
  await db
    .update(sequenceEnrolments)
    .set({
      currentStepId: patch.currentStepId,
      currentStepOrder: patch.currentStepOrder,
      nextDueAt: patch.nextDueAt,
      lastExecutionCounter: patch.lastExecutionCounter,
    })
    .where(eq(sequenceEnrolments.id, enrolmentId));
}

/** Bump only the loop counter (used when a step executes without advancing). */
export async function bumpEnrolmentCounter(db: DbOrTx, enrolmentId: string, lastExecutionCounter: number) {
  await db
    .update(sequenceEnrolments)
    .set({ lastExecutionCounter })
    .where(eq(sequenceEnrolments.id, enrolmentId));
}

export async function endEnrolment(
  db: DbOrTx,
  enrolmentId: string,
  endReason: SequenceEndReason,
  endedAt: Date,
) {
  await db
    .update(sequenceEnrolments)
    .set({
      status: endStatusFor(endReason),
      endReason,
      endedAt,
    })
    .where(eq(sequenceEnrolments.id, enrolmentId));
}

export async function setEnrolmentStatus(
  db: DbOrTx,
  orgId: string,
  enrolmentId: string,
  status: "active" | "paused",
) {
  await db
    .update(sequenceEnrolments)
    .set({ status })
    .where(
      and(
        eq(sequenceEnrolments.organizationId, orgId),
        eq(sequenceEnrolments.id, enrolmentId),
      ),
    );
}

/**
 * Maps an end reason to the terminal status enum value. Keeps the two columns
 * (status + end_reason) consistent — the DB CHECK constraint enforces this too.
 */
function endStatusFor(reason: SequenceEndReason) {
  switch (reason) {
    case "exhausted":
      return "completed_exhausted" as const;
    case "success":
      return "completed_success" as const;
    case "cascaded":
      return "completed_cascaded" as const;
    case "opted_out":
      return "stopped_opted_out" as const;
    case "manual":
      return "stopped_manual" as const;
    case "safety_loop_cap_reached":
      return "completed_exhausted" as const;
  }
}

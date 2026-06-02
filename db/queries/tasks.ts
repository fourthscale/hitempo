import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, gte, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { companies, contacts, tasks, sequenceStepExecutions, sequenceSteps, sites } from "@/db/schema";

export type TaskWithContext = Awaited<ReturnType<typeof getTasksByOrg>>[number];

export async function getTasksByOrg(
  orgId: string,
  assigneeId?: string | null,
  status?: "active" | "pending" | "in_progress" | "completed",
) {
  const statusFilter =
    status === "pending"     ? eq(tasks.status, "pending") :
    status === "in_progress" ? eq(tasks.status, "in_progress") :
    status === "completed"   ? eq(tasks.status, "completed") :
    or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress"));

  const rows = await getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      statusFilter,
      assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
    ),
    with: {
      company: {
        columns: {
          id: true, name: true, score: true,
          signalType: true, signalDetectedAt: true,
        },
      },
      contact: {
        columns: {
          id: true, kind: true, firstName: true, lastName: true, jobTitle: true,
          email: true, preferredLanguage: true,
        },
      },
      sequenceEnrolment: {
        columns: { id: true, currentStepOrder: true },
        with: {
          sequence: {
            // messageContextScope drives the AI "scope its context to
            // this sequence" toggle in the GenerateMessageDialog
            // (sprint 12). The step override is resolved server-side
            // by the action layer at generate time.
            columns: { id: true, name: true, messageContextScope: true },
            with: { steps: { columns: { id: true } } },
          },
        },
      },
    },
    orderBy: status === "completed"
      ? [desc(tasks.completedAt)]
      // Sort by the effective date (scheduled_for falls back to due_at) so
      // engine-scheduled tasks land in the right position. NULLS LAST keeps
      // dateless tasks at the bottom of the active list.
      : [sql`coalesce(${tasks.scheduledFor}, ${tasks.dueAt}) asc nulls last`, desc(tasks.priority)],
    limit: 200,
  });

  // Attach `sourceStepOrder` (the step that CREATED the task) for tasks
  // that came from a sequence. The UI displays this — not the enrolment's
  // current cursor — so a task still pending shows "Étape 1 sur 3" instead
  // of "Étape 2 sur 3" (the engine has technically advanced).
  // Sprint 12 phase 3 — also attach `sourceStepMode` so the task action
  // menu can route to the right dialog (AI vs defined-template).
  const taskIds = rows.filter((r) => r.sequenceEnrolmentId).map((r) => r.id);
  const infoByTaskId = await loadSourceStepInfoForTasks(taskIds);
  return rows.map((r) => ({
    ...r,
    sourceStepOrder: r.id ? infoByTaskId.get(r.id)?.stepOrder ?? null : null,
    sourceStepMode: r.id ? infoByTaskId.get(r.id)?.mode ?? null : null,
  }));
}

/**
 * Internal helper : given task ids, return a map of taskId → stepOrder of
 * the `sequence_step_executions` row that produced each task. Empty map
 * for an empty input. Engine-private (no org filter) — callers must
 * already have scoped their `tasks` query.
 */
async function loadSourceStepInfoForTasks(
  taskIds: string[],
): Promise<Map<string, { stepOrder: number; mode: "ai" | "defined" | null }>> {
  const map = new Map<string, { stepOrder: number; mode: "ai" | "defined" | null }>();
  if (taskIds.length === 0) return map;
  // Join sequence_step_executions → sequence_steps to read `action_config.mode`.
  // Steps that aren't send_email / send_linkedin have no mode → null.
  const rows = await getDb()
    .select({
      taskId: sequenceStepExecutions.taskId,
      stepOrder: sequenceStepExecutions.stepOrder,
      actionConfig: sequenceSteps.actionConfig,
    })
    .from(sequenceStepExecutions)
    .innerJoin(sequenceSteps, eq(sequenceSteps.id, sequenceStepExecutions.stepId))
    .where(inArray(sequenceStepExecutions.taskId, taskIds));
  for (const r of rows) {
    if (!r.taskId) continue;
    const rawMode = (r.actionConfig as { mode?: unknown } | null)?.mode;
    const mode: "ai" | "defined" | null =
      rawMode === "ai" || rawMode === "defined" ? rawMode : null;
    map.set(r.taskId, { stepOrder: r.stepOrder, mode });
  }
  return map;
}

export async function getTasksDashboard(orgId: string, assigneeId?: string | null) {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  return getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
      lte(tasks.dueAt, endOfToday),
      assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
    ),
    with: {
      company: { columns: { id: true, name: true, score: true, signalType: true, notes: true } },
      contact: { columns: { id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true } },
    },
    orderBy: [asc(tasks.dueAt)],
    limit: 10,
  });
}

export async function countTodayTasksByOrg(orgId: string, assigneeId?: string | null): Promise<number> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const rows = await getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
      gte(tasks.dueAt, startOfToday),
      lte(tasks.dueAt, endOfToday),
      assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
    ),
    columns: { id: true },
  });
  return rows.length;
}

export async function countOverdueTasksByOrg(orgId: string, assigneeId?: string | null): Promise<number> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = await getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
      lt(tasks.dueAt, startOfToday),
      assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
    ),
    columns: { id: true },
  });
  return rows.length;
}

/**
 * Returns the age in days of the oldest overdue task — i.e. days since the
 * earliest `due_at` among pending/in_progress tasks past their deadline.
 * Used by the dashboard's "En retard" KPI : "Le plus vieux : 3 j".
 *
 * Returns 0 when no overdue tasks (callers can render `—` accordingly).
 */
export async function getOldestOverdueTaskAgeDays(
  orgId: string,
  assigneeId?: string | null,
): Promise<number> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const rows = await getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
      lt(tasks.dueAt, startOfToday),
      assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
    ),
    columns: { dueAt: true },
    orderBy: [asc(tasks.dueAt)],
    limit: 1,
  });
  const oldest = rows[0]?.dueAt;
  if (!oldest) return 0;
  const ms = startOfToday.getTime() - oldest.getTime();
  return Math.max(1, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export async function countPendingTasksByOrg(orgId: string, assigneeId?: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, orgId),
        or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
        assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
      ),
    );
  return row?.c ?? 0;
}

export async function getTasksByCompany(orgId: string, companyId: string) {
  return getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      eq(tasks.companyId, companyId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
    ),
    with: {
      contact: { columns: { id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true } },
    },
    orderBy: [asc(tasks.dueAt)],
    limit: 20,
  });
}

export async function countTasksByCompany(orgId: string, companyId: string): Promise<number> {
  const rows = await getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      eq(tasks.companyId, companyId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
    ),
    columns: { id: true },
  });
  return rows.length;
}

export async function getTasksByContact(orgId: string, contactId: string) {
  return getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      eq(tasks.contactId, contactId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
    ),
    with: {
      company: { columns: { id: true, name: true } },
    },
    orderBy: [asc(tasks.dueAt)],
    limit: 20,
  });
}

export async function countCompletedTasksThisWeek(orgId: string): Promise<number> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1);

  const rows = await getDb().query.tasks.findMany({
    where: and(
      eq(tasks.organizationId, orgId),
      eq(tasks.status, "completed"),
      gte(tasks.completedAt, startOfWeek),
    ),
    columns: { id: true },
  });
  return rows.length;
}

export async function createTask(
  orgId: string,
  assigneeId: string,
  data: {
    type: typeof tasks.$inferInsert["type"];
    title: string;
    description?: string | null;
    priority?: typeof tasks.$inferInsert["priority"];
    dueAt?: Date | null;
    /** Sprint 12.5 — when true, the UI hides the hour part of dueAt
     *  ("vendredi 14h30" → "vendredi"). The column is non-null in the
     *  DB; we default to false on create. */
    dueAtAllDay?: boolean;
    /** When the sale should actually handle the task (distinct from
     *  dueAt = the hard deadline). The engine uses this for agenda
     *  placement + anti-conflit. */
    scheduledFor?: Date | null;
    /** Slot duration in minutes — used by the agenda anti-conflict
     *  finder. Null = engine default for the task type. */
    estimatedDurationMinutes?: number | null;
    companyId?: string | null;
    contactId?: string | null;
    /** Optional site (when the company has several — useful for
     *  field-visit tasks). */
    siteId?: string | null;
  },
) {
  const [row] = await getDb()
    .insert(tasks)
    .values({
      organizationId: orgId,
      assigneeId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority ?? "medium",
      dueAt: data.dueAt ?? null,
      dueAtAllDay: data.dueAtAllDay ?? false,
      scheduledFor: data.scheduledFor ?? null,
      estimatedDurationMinutes: data.estimatedDurationMinutes ?? null,
      companyId: data.companyId ?? null,
      contactId: data.contactId ?? null,
      siteId: data.siteId ?? null,
      status: "pending",
    })
    .returning();
  return row;
}

/**
 * Insert a task on behalf of the sequence engine (runs as the admin pool,
 * outside an RLS user session) and link it to its enrolment. Distinct from
 * `createTask` (RLS, user-driven) : takes an explicit `db` and the
 * `sequenceEnrolmentId` FK.
 */
export async function insertTaskForEnrolment(
  db: Db,
  orgId: string,
  data: {
    assigneeId: string | null;
    sequenceEnrolmentId: string;
    type: typeof tasks.$inferInsert["type"];
    title: string;
    description?: string | null;
    companyId?: string | null;
    contactId?: string | null;
    /** When the sale should actually handle the task. */
    scheduledFor?: Date | null;
    /** Hard deadline (optional). */
    dueAt?: Date | null;
    /** UI hint to hide the hour part of dueAt. */
    dueAtAllDay?: boolean;
    /** Effective slot duration in minutes (defaulted from step scheduling). */
    estimatedDurationMinutes?: number | null;
  },
) {
  const [row] = await db
    .insert(tasks)
    .values({
      organizationId: orgId,
      assigneeId: data.assigneeId,
      sequenceEnrolmentId: data.sequenceEnrolmentId,
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      priority: "medium",
      scheduledFor: data.scheduledFor ?? null,
      dueAt: data.dueAt ?? null,
      dueAtAllDay: data.dueAtAllDay ?? false,
      estimatedDurationMinutes: data.estimatedDurationMinutes ?? null,
      companyId: data.companyId ?? null,
      contactId: data.contactId ?? null,
      status: "pending",
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error("insertTaskForEnrolment: no row returned");
  return row;
}

export async function completeTask(
  orgId: string,
  taskId: string,
  userId: string,
  /** Optional DB override for background jobs (Inngest crons) running
   *  outside an authenticated user session. */
  dbOverride?: Db,
) {
  await (dbOverride ?? getDb())
    .update(tasks)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)));
}

export async function deleteTask(orgId: string, taskId: string) {
  await getDb()
    .update(tasks)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)));
}

export async function getTaskById(orgId: string, taskId: string) {
  return getDb().query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)),
    with: {
      company: { columns: { id: true, name: true } },
      contact: { columns: { id: true, kind: true, firstName: true, lastName: true, email: true } },
    },
  });
}

/** Richer variant used by the task detail page. */
export async function getTaskDetail(orgId: string, taskId: string) {
  const row = await getDb().query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)),
    with: {
      company: {
        columns: { id: true, name: true, score: true, signalType: true, signalDetectedAt: true },
      },
      contact: {
        columns: { id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true, preferredLanguage: true },
      },
      sequenceEnrolment: {
        columns: { id: true, currentStepOrder: true },
        with: {
          sequence: {
            // messageContextScope drives the AI "scope its context to
            // this sequence" toggle in the GenerateMessageDialog
            // (sprint 12). The step override is resolved server-side
            // by the action layer at generate time.
            columns: { id: true, name: true, messageContextScope: true },
            with: { steps: { columns: { id: true } } },
          },
        },
      },
    },
  });
  if (!row) return null;
  // Same enrichment as getTasksByOrg : surface the step that created the
  // task so the UI shows it instead of the engine's already-advanced cursor.
  // Sprint 12 phase 3 — also expose `sourceStepMode` for AI-vs-defined routing.
  const infoByTaskId = row.sequenceEnrolmentId
    ? await loadSourceStepInfoForTasks([row.id])
    : new Map<string, { stepOrder: number; mode: "ai" | "defined" | null }>();
  const info = infoByTaskId.get(row.id);
  return {
    ...row,
    sourceStepOrder: info?.stepOrder ?? null,
    sourceStepMode: info?.mode ?? null,
  };
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

/**
 * Batch lookup used by the enrolment detail page to label each execution row
 * with its underlying task. Returns only the fields needed to render a link.
 */
export async function getTasksByIds(orgId: string, taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return getDb()
    .select({
      id: tasks.id,
      title: tasks.title,
      type: tasks.type,
      status: tasks.status,
      scheduledFor: tasks.scheduledFor,
      dueAt: tasks.dueAt,
      dueAtAllDay: tasks.dueAtAllDay,
    })
    .from(tasks)
    .where(and(eq(tasks.organizationId, orgId), inArray(tasks.id, taskIds)));
}

export async function updateTask(
  orgId: string,
  taskId: string,
  data: {
    type: typeof tasks.$inferInsert["type"];
    title: string;
    description?: string | null;
    priority?: typeof tasks.$inferInsert["priority"];
    dueAt?: Date | null;
    dueAtAllDay?: boolean;
    scheduledFor?: Date | null;
    estimatedDurationMinutes?: number | null;
    assigneeId?: string | null;
    companyId?: string | null;
    contactId?: string | null;
    siteId?: string | null;
  },
) {
  const [row] = await getDb()
    .update(tasks)
    .set({
      type: data.type,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority ?? "medium",
      dueAt: data.dueAt ?? null,
      dueAtAllDay: data.dueAtAllDay ?? false,
      scheduledFor: data.scheduledFor ?? null,
      estimatedDurationMinutes: data.estimatedDurationMinutes ?? null,
      assigneeId: data.assigneeId ?? null,
      companyId: data.companyId ?? null,
      contactId: data.contactId ?? null,
      siteId: data.siteId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)))
    .returning();
  return row;
}

export async function getCompaniesForTaskForm(orgId: string) {
  return getDb().query.companies.findMany({
    where: and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)),
    columns: { id: true, name: true },
    orderBy: [asc(companies.name)],
    limit: 200,
  });
}

export async function getContactsForTaskForm(orgId: string, companyId?: string | null) {
  if (!companyId) return [];
  return getDb().query.contacts.findMany({
    where: and(
      eq(contacts.organizationId, orgId),
      eq(contacts.companyId, companyId),
      isNull(contacts.deletedAt),
    ),
    columns: { id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true },
    orderBy: [asc(contacts.lastName)],
    limit: 100,
  });
}

/**
 * Sprint 12.5 — sites for a given company, used by the task form's
 * site select. Primary site first, then alpha order. Empty when no
 * company is selected (the field stays disabled UX-side).
 */
export async function getSitesForTaskForm(orgId: string, companyId?: string | null) {
  if (!companyId) return [];
  return getDb().query.sites.findMany({
    where: and(eq(sites.organizationId, orgId), eq(sites.companyId, companyId)),
    columns: { id: true, name: true, isPrimary: true },
    orderBy: [desc(sites.isPrimary), asc(sites.name)],
    limit: 100,
  });
}

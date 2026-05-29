import "server-only";
import { and, asc, count, desc, eq, isNull, lt, lte, gte, or } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { companies, contacts, tasks } from "@/db/schema";

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

  return getDb().query.tasks.findMany({
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
    },
    orderBy: status === "completed"
      ? [desc(tasks.completedAt)]
      : [asc(tasks.dueAt), desc(tasks.priority)],
    limit: 200,
  });
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
    companyId?: string | null;
    contactId?: string | null;
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
      companyId: data.companyId ?? null,
      contactId: data.contactId ?? null,
      status: "pending",
    })
    .returning();
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
  return getDb().query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.organizationId, orgId)),
    with: {
      company: {
        columns: { id: true, name: true, score: true, signalType: true, signalDetectedAt: true },
      },
      contact: {
        columns: { id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true, preferredLanguage: true },
      },
    },
  });
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

export async function updateTask(
  orgId: string,
  taskId: string,
  data: {
    type: typeof tasks.$inferInsert["type"];
    title: string;
    description?: string | null;
    priority?: typeof tasks.$inferInsert["priority"];
    dueAt?: Date | null;
    assigneeId?: string | null;
    companyId?: string | null;
    contactId?: string | null;
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
      assigneeId: data.assigneeId ?? null,
      companyId: data.companyId ?? null,
      contactId: data.contactId ?? null,
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

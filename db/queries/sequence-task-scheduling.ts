import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  organizations,
  organizationMembers,
  contacts,
  companies,
  sites,
  tasks,
} from "@/db/schema";
import {
  DEFAULT_WORK_PATTERN,
  type WorkPattern,
} from "@/lib/sequences/work-pattern";
import type { ExistingTask, TaskTypeKey } from "@/lib/sequences/task-slot-finder";

/**
 * Bundle of everything the engine needs to schedule a new task for a given
 * contact + sale. Returned by `loadSchedulingContext`.
 *
 * Cascades :
 *  - `contactTz`  : contact.timezone ?? site.timezone ?? company.timezone ?? org.timezone
 *  - `saleTz`     : member.timezone ?? org.timezone
 *  - `workPattern`: member.work_pattern (parsed) ?? DEFAULT_WORK_PATTERN
 *
 * `assigneeMember` is null when the task has no assignee (rare — falls back
 * to the enrolment's enroller in `resolveAssignee` upstream). In that case
 * the slot-finder is bypassed by the caller.
 */
export type SchedulingContext = {
  contactTz: string;
  assigneeMember: {
    userId: string;
    timezone: string;
    workPattern: WorkPattern;
    maxEmailsPerDay: number;
    maxCallsPerDay: number;
  } | null;
};

export async function loadSchedulingContext(
  db: Db,
  orgId: string,
  contactId: string,
  assigneeUserId: string | null,
): Promise<SchedulingContext> {
  // Contact TZ cascade — single query joining the chain.
  const [contactRow] = await db
    .select({
      contactTz: contacts.timezone,
      siteTz: sites.timezone,
      companyTz: companies.timezone,
      orgTz: organizations.timezone,
    })
    .from(contacts)
    .leftJoin(sites, eq(sites.id, contacts.siteId))
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .innerJoin(organizations, eq(organizations.id, contacts.organizationId))
    .where(and(eq(contacts.organizationId, orgId), eq(contacts.id, contactId)))
    .limit(1);

  const contactTz =
    contactRow?.contactTz ??
    contactRow?.siteTz ??
    contactRow?.companyTz ??
    contactRow?.orgTz ??
    "Europe/Paris";

  // Assignee member — TZ + work pattern + quotas.
  let assigneeMember: SchedulingContext["assigneeMember"] = null;
  if (assigneeUserId) {
    const [memberRow] = await db
      .select({
        userId: organizationMembers.userId,
        timezone: organizationMembers.timezone,
        workPattern: organizationMembers.workPattern,
        maxEmailsPerDay: organizationMembers.maxEmailsPerDay,
        maxCallsPerDay: organizationMembers.maxCallsPerDay,
      })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, assigneeUserId),
        ),
      )
      .limit(1);

    if (memberRow) {
      assigneeMember = {
        userId: memberRow.userId,
        timezone: memberRow.timezone,
        workPattern: (memberRow.workPattern as WorkPattern | null) ?? DEFAULT_WORK_PATTERN,
        maxEmailsPerDay: memberRow.maxEmailsPerDay,
        maxCallsPerDay: memberRow.maxCallsPerDay,
      };
    }
  }

  return { contactTz, assigneeMember };
}

/**
 * Tasks already on the assignee's agenda in the search window — used as the
 * conflict / quota set for `findNextFreeSlot`. We don't filter out completed
 * tasks: even a done task may have blocked a slot in the past, but for
 * future slots we want the count of pending/in-progress.
 *
 * For quota counting we keep ALL same-day tasks (pending + completed) since
 * quota = "how many of this type did the sale schedule today". For conflict
 * we keep only pending/in-progress (a completed task doesn't block its
 * slot). We let the slot-finder handle that distinction via the
 * `existingTasks` data — for V1, simplest : pass pending + in-progress only.
 */
export async function loadAssigneeTasksInWindow(
  db: Db,
  orgId: string,
  assigneeUserId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<ExistingTask[]> {
  const rows = await db
    .select({
      scheduledFor: tasks.scheduledFor,
      estimatedDurationMinutes: tasks.estimatedDurationMinutes,
      type: tasks.type,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, orgId),
        eq(tasks.assigneeId, assigneeUserId),
        sql`${tasks.status} IN ('pending', 'in_progress')`,
        gte(tasks.scheduledFor, fromUtc),
        lt(tasks.scheduledFor, toUtc),
      ),
    )
    .limit(500);

  const out: ExistingTask[] = [];
  for (const r of rows) {
    if (r.scheduledFor == null) continue;
    out.push({
      scheduledFor: r.scheduledFor,
      estimatedDurationMinutes: r.estimatedDurationMinutes ?? 5,
      type: r.type as TaskTypeKey,
    });
  }
  return out;
}

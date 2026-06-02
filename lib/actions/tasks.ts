"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActiveOrg } from "@/lib/auth/context";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { createTask, completeTask, deleteTask, updateTask } from "@/db/queries/tasks";
import { emitSequenceTaskCompleted } from "@/lib/sequences/engine/emit-task-completed";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

const taskTypeEnum = z.enum(["email", "linkedin", "phone", "visit", "follow_up", "research", "other"]);
const taskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

// Shared by create + update — the 4 Sprint 12.5 fields, plus a coercer for
// the optional integer (estimatedDurationMinutes). Kept as a fragment so
// add/edit stay structurally identical and any future tweak lands in one
// place.
const sharedTaskFields = {
  type: taskTypeEnum,
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().or(z.literal("")),
  priority: taskPriorityEnum.optional().default("medium"),
  // Hard deadline (`datetime-local` from the UI ; parsed to Date below).
  dueAt: z.string().optional().or(z.literal("")),
  // Sprint 12.5 — when true the UI hides the hour part of dueAt.
  // `<input type="checkbox">` posts "on" when checked and nothing when
  // not, so we coerce conservatively.
  dueAtAllDay: z.preprocess(
    (v) => v === "on" || v === "true" || v === true,
    z.boolean(),
  ),
  // When the sale should actually handle the task (vs the deadline).
  scheduledFor: z.string().optional().or(z.literal("")),
  // Slot duration in minutes — capped at 8h ; null = engine default.
  estimatedDurationMinutes: z
    .preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().max(480).nullable())
    .optional(),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
  companyId: z.string().uuid().optional().or(z.literal("")),
  contactId: z.string().uuid().optional().or(z.literal("")),
  // Optional site — bound to the selected company (field-visit tasks).
  siteId: z.string().uuid().optional().or(z.literal("")),
} as const;

const createSchema = z.object(sharedTaskFields);

async function _createTaskAction(formData: FormData) {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization, user } = await getActiveOrg();
  const d = parsed.data;

  const assigneeId = d.assigneeId || user.id;
  await createTask(activeOrganization.id, assigneeId, {
    type: d.type,
    title: d.title,
    description: d.description || null,
    priority: d.priority,
    dueAt: d.dueAt ? new Date(d.dueAt) : null,
    dueAtAllDay: d.dueAtAllDay,
    scheduledFor: d.scheduledFor ? new Date(d.scheduledFor) : null,
    estimatedDurationMinutes: d.estimatedDurationMinutes ?? null,
    companyId: d.companyId || null,
    contactId: d.contactId || null,
    siteId: d.siteId || null,
  });

  revalidatePath("/tasks");
  if (d.companyId) void recomputeCompanyScore(activeOrganization.id, d.companyId);
  redirect("/tasks");
}

async function _completeTaskAction(formData: FormData) {
  const taskId = z.string().uuid().safeParse(formData.get("taskId"));
  if (!taskId.success) throw new InvalidInputError(taskId.error);

  const { activeOrganization, user } = await getActiveOrg();
  await completeTask(activeOrganization.id, taskId.data, user.id);
  // If this task belongs to a sequence, let the engine advance it now.
  await emitSequenceTaskCompleted(activeOrganization.id, taskId.data);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

const updateSchema = z.object({
  taskId: z.string().uuid(),
  ...sharedTaskFields,
});

async function _updateTaskAction(formData: FormData) {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const d = parsed.data;

  await updateTask(activeOrganization.id, d.taskId, {
    type: d.type,
    title: d.title,
    description: d.description || null,
    priority: d.priority,
    dueAt: d.dueAt ? new Date(d.dueAt) : null,
    dueAtAllDay: d.dueAtAllDay,
    scheduledFor: d.scheduledFor ? new Date(d.scheduledFor) : null,
    estimatedDurationMinutes: d.estimatedDurationMinutes ?? null,
    assigneeId: d.assigneeId || null,
    companyId: d.companyId || null,
    contactId: d.contactId || null,
    siteId: d.siteId || null,
  });

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (d.companyId) void recomputeCompanyScore(activeOrganization.id, d.companyId);
  redirect("/tasks");
}

async function _updateTaskStatusAction(formData: FormData) {
  const parsed = z.object({
    taskId: z.string().uuid(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization, user } = await getActiveOrg();
  const { taskId, status } = parsed.data;

  const [updated] = await getDb()
    .update(tasks)
    .set({
      status,
      completedAt: status === "completed" ? new Date() : null,
      completedBy: status === "completed" ? user.id : null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, activeOrganization.id)))
    .returning({ companyId: tasks.companyId });

  if (status === "completed") {
    await emitSequenceTaskCompleted(activeOrganization.id, taskId);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (updated?.companyId) void recomputeCompanyScore(activeOrganization.id, updated.companyId);
}

async function _deleteTaskAction(formData: FormData) {
  const taskId = z.string().uuid().safeParse(formData.get("taskId"));
  if (!taskId.success) throw new InvalidInputError(taskId.error);

  const { activeOrganization } = await getActiveOrg();

  const task = await getDb().query.tasks.findFirst({
    where: and(eq(tasks.id, taskId.data), eq(tasks.organizationId, activeOrganization.id)),
    columns: { companyId: true },
  });

  await deleteTask(activeOrganization.id, taskId.data);

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (task?.companyId) void recomputeCompanyScore(activeOrganization.id, task.companyId);
}

// ---------------------------------------------------------------------------
// Wrapped exports — see lib/actions/wrap-action-error.ts
// ---------------------------------------------------------------------------

export const createTaskAction = withActionError(_createTaskAction);
export const completeTaskAction = withActionError(_completeTaskAction);
export const updateTaskAction = withActionError(_updateTaskAction);
export const updateTaskStatusAction = withActionError(_updateTaskStatusAction);
export const deleteTaskAction = withActionError(_deleteTaskAction);

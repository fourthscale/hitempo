"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActiveOrg } from "@/lib/auth/context";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { createTask, completeTask, deleteTask, updateTask } from "@/db/queries/tasks";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

const taskTypeEnum = z.enum(["email", "linkedin", "phone", "visit", "follow_up", "research", "other"]);
const taskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);

const createSchema = z.object({
  type: taskTypeEnum,
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().or(z.literal("")),
  priority: taskPriorityEnum.optional().default("medium"),
  dueAt: z.string().optional().or(z.literal("")),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
  companyId: z.string().uuid().optional().or(z.literal("")),
  contactId: z.string().uuid().optional().or(z.literal("")),
});

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
    companyId: d.companyId || null,
    contactId: d.contactId || null,
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

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

const updateSchema = z.object({
  taskId: z.string().uuid(),
  type: taskTypeEnum,
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().or(z.literal("")),
  priority: taskPriorityEnum.optional().default("medium"),
  dueAt: z.string().optional().or(z.literal("")),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
  companyId: z.string().uuid().optional().or(z.literal("")),
  contactId: z.string().uuid().optional().or(z.literal("")),
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
    assigneeId: d.assigneeId || null,
    companyId: d.companyId || null,
    contactId: d.contactId || null,
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

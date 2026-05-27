import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/auth/context";
import { getTaskById, getCompaniesForTaskForm, getContactsForTaskForm } from "@/db/queries/tasks";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { updateTaskAction } from "@/lib/actions/tasks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompanyContactSelect } from "@/components/app/company-contact-select";

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;

  const [task, companiesList, members] = await Promise.all([
    getTaskById(orgId, id),
    getCompaniesForTaskForm(orgId),
    getOrgMembersWithNames(orgId),
  ]);

  if (!task) notFound();

  const contactsList = await getContactsForTaskForm(orgId, task.companyId);

  const t = await getTranslations("pages.tasks");
  const tTaskType = await getTranslations("taskType");
  const tPriority = await getTranslations("taskPriority");

  const taskTypes = ["email", "linkedin", "phone", "visit", "follow_up", "research", "other"] as const;
  const priorities = ["low", "medium", "high", "urgent"] as const;

  const dueAtValue = task.dueAt
    ? new Date(task.dueAt.getTime() - task.dueAt.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";

  return (
    <div className="max-w-[640px] mx-auto">
      <nav className="text-xs text-muted-foreground mb-4">
        <Link href="/tasks" className="hover:text-foreground">{t("breadcrumb")}</Link>
        {" / "}
        <span className="text-foreground">{t("edit.title")}</span>
      </nav>

      <h1 className="font-serif text-3xl font-bold mb-6">{t("edit.title")}</h1>

      <Card className="p-6">
        <form action={updateTaskAction} className="space-y-5">
          <input type="hidden" name="taskId" value={task.id} />

          {/* Type */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              {t("fields.type")} *
            </label>
            <select
              name="type"
              required
              defaultValue={task.type}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              {taskTypes.map((v) => (
                <option key={v} value={v}>{tTaskType(v)}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              {t("fields.title")} *
            </label>
            <input
              type="text"
              name="title"
              required
              maxLength={300}
              defaultValue={task.title}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              {t("fields.description")}
            </label>
            <textarea
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={task.description ?? ""}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-y"
            />
          </div>

          {/* Priority + Due date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("fields.priority")}
              </label>
              <select
                name="priority"
                defaultValue={task.priority}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                {priorities.map((v) => (
                  <option key={v} value={v}>{tPriority(v)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("fields.dueAt")}
              </label>
              <input
                type="datetime-local"
                name="dueAt"
                defaultValue={dueAtValue}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              {t("fields.assignee")}
            </label>
            <select
              name="assigneeId"
              defaultValue={task.assigneeId ?? user.id}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === user.id ? `${m.displayName} ${t("assigneeMeSuffix")}` : m.displayName}
                </option>
              ))}
            </select>
          </div>

          <CompanyContactSelect
            companies={companiesList}
            defaultCompanyId={task.companyId ?? undefined}
            defaultContactId={task.contactId ?? undefined}
            initialContacts={contactsList}
            labelCompany={t("fields.company")}
            labelContact={t("fields.contact")}
            placeholderCompany={t("fields.noCompany")}
            placeholderContact={t("fields.noContact")}
            hintSelectCompany={t("fields.selectCompanyFirst")}
          />

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link href="/tasks">
              <Button type="button" variant="outline">{t("create.cancel")}</Button>
            </Link>
            <SubmitButton>{t("edit.submit")}</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

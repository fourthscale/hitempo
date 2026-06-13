import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/auth/context";
import {
  getTaskById,
  getCompaniesForTaskForm,
  getContactsForTaskForm,
  getSitesForTaskForm,
} from "@/db/queries/tasks";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { updateTaskAction } from "@/lib/actions/tasks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompanyContactSelect } from "@/components/app/company-contact-select";
import { TaskDueAtField } from "@/components/app/task-due-at-field";
import { FormFooter } from "@/components/app/form-footer";

/**
 * Format a Date for `<input type="datetime-local">` (local TZ, no
 * seconds). Returns "" when the date is null.
 */
function toDateTimeLocal(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

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

  const [contactsList, sitesList] = await Promise.all([
    getContactsForTaskForm(orgId, task.companyId),
    getSitesForTaskForm(orgId, task.companyId),
  ]);

  const t = await getTranslations("pages.tasks");
  const tTaskType = await getTranslations("taskType");
  const tPriority = await getTranslations("taskPriority");

  const taskTypes = ["email", "linkedin", "phone", "visit", "research", "other"] as const;
  const priorities = ["low", "medium", "high", "urgent"] as const;

  const dueAtValue = toDateTimeLocal(task.dueAt);
  const scheduledForValue = toDateTimeLocal(task.scheduledFor);

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

          {/* Priority + Due date with all-day toggle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <TaskDueAtField
              label={t("fields.dueAt")}
              allDayLabel={t("fields.dueAtAllDay")}
              defaultDueAt={dueAtValue}
              defaultAllDay={Boolean(task.dueAtAllDay)}
            />
          </div>

          {/* Scheduled-for + estimated duration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("fields.scheduledFor")}
              </label>
              <input
                type="datetime-local"
                name="scheduledFor"
                defaultValue={scheduledForValue}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("fields.scheduledForHint")}
              </p>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("fields.estimatedDurationMinutes")}
              </label>
              <input
                type="number"
                name="estimatedDurationMinutes"
                min={1}
                max={480}
                step={1}
                defaultValue={task.estimatedDurationMinutes ?? ""}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                placeholder={t("fields.estimatedDurationPlaceholder")}
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
            defaultSiteId={task.siteId ?? undefined}
            initialContacts={contactsList}
            initialSites={sitesList}
            labelCompany={t("fields.company")}
            labelContact={t("fields.contact")}
            labelSite={t("fields.site")}
            placeholderCompany={t("fields.noCompany")}
            placeholderContact={t("fields.noContact")}
            placeholderSite={t("fields.noSite")}
            hintSelectCompany={t("fields.selectCompanyFirst")}
            withSite
          />

          <FormFooter>
            <Link href="/tasks">
              <Button type="button" variant="outline">{t("create.cancel")}</Button>
            </Link>
            <SubmitButton>{t("edit.submit")}</SubmitButton>
          </FormFooter>
        </form>
      </Card>
    </div>
  );
}

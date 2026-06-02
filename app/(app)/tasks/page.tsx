import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import {
  Mail, Phone, MapPin, RefreshCcw, Search, Calendar,
  ChevronDown, LayoutList, LayoutGrid, Plus, User, Workflow,
} from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { GmailCredentialsServiceFactory } from "@/lib/gmail/gmail-credentials-service-factory";
import { getTasksByOrg, countOverdueTasksByOrg, countTodayTasksByOrg, countPendingTasksByOrg, countCompletedTasksThisWeek } from "@/db/queries/tasks";
import { getWeeklyInteractionStats } from "@/db/queries/interactions";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { getBrandBriefStatus, type BrandBriefStatus } from "@/db/queries/brand";
import { FilterSelect } from "@/components/app/filter-select";
import { TaskRowActions, type TaskGenerateContext } from "@/components/app/task-row-actions";
import {
  getMessageDefaultsFromTask,
  getMessageDefaultLocale,
  getDetectedSignalProp,
} from "@/lib/messages/task-defaults";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { scoreGrade, scoreBadgeClasses } from "@/lib/scoring/grade";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskWithContext } from "@/db/queries/tasks";

type Period = "all" | "today" | "week" | "later";
type StatusFilter = "active" | "pending" | "in_progress" | "completed";

function parsePeriod(raw: string | undefined): Period {
  if (raw === "today" || raw === "week" || raw === "later") return raw;
  return "all";
}

function parseStatus(raw: string | undefined): StatusFilter {
  if (raw === "pending" || raw === "in_progress" || raw === "completed") return raw;
  return "active";
}

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function endOfWeek(d: Date) {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(23, 59, 59, 999);
  return r;
}

type TaskGroup = "overdue" | "today" | "tomorrow" | "week" | "later" | "no_date";

/**
 * `scheduled_for` is the engine-picked "do it then" slot (sequence
 * automations populate this). `due_at` is the optional hard deadline. We
 * surface the soonest of the two as the user-facing date for grouping +
 * display ; overdue logic still keys off `due_at` only since that's the
 * deadline semantic, not the suggested slot.
 */
function effectiveDate(task: { scheduledFor: Date | null; dueAt: Date | null }): Date | null {
  return task.scheduledFor ?? task.dueAt;
}

function getTaskGroup(dueAt: Date | null, now: Date): TaskGroup {
  if (!dueAt) return "no_date";
  const due = startOfDay(dueAt);
  const today = startOfDay(now);
  const tomorrow = startOfDay(addDays(today, 1));
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  if (due.getTime() === tomorrow.getTime()) return "tomorrow";
  if (dueAt <= endOfWeek(today)) return "week";
  return "later";
}

function taskTypeIcon(type: string) {
  switch (type) {
    case "email": return { Icon: Mail, bg: "bg-blue-100 text-blue-600" };
    case "follow_up": return { Icon: RefreshCcw, bg: "bg-amber-100 text-amber-600" };
    case "phone": return { Icon: Phone, bg: "bg-violet-100 text-violet-600" };
    case "visit": return { Icon: MapPin, bg: "bg-lime-100 text-lime-700" };
    case "linkedin": return { Icon: Mail, bg: "bg-sky-100 text-sky-600" };
    case "meeting": return { Icon: Calendar, bg: "bg-emerald-100 text-emerald-600" };
    case "research": return { Icon: Search, bg: "bg-slate-100 text-slate-600" };
    default: return { Icon: RefreshCcw, bg: "bg-slate-100 text-slate-500" };
  }
}

function formatDueDate(dueAt: Date | null, locale: string): string | null {
  if (!dueAt) return null;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dueAt);
}

function daysDiff(dueAt: Date, now: Date): number {
  return Math.floor((startOfDay(now).getTime() - startOfDay(dueAt).getTime()) / (1000 * 60 * 60 * 24));
}

function buildHref(period: Period, assignee: string, status: StatusFilter) {
  const params = new URLSearchParams();
  if (period !== "all") params.set("period", period);
  if (assignee !== "me") params.set("assignee", assignee);
  if (status !== "active") params.set("status", status);
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; assignee?: string; status?: string }>;
}) {
  const { period: rawPeriod, assignee: rawAssignee, status: rawStatus } = await searchParams;
  const period = parsePeriod(rawPeriod);
  const status = parseStatus(rawStatus);

  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;
  const gmailStatus = await GmailCredentialsServiceFactory.getInstance().getConnectionStatus(user.id);
  const locale = await getLocale();
  const t = await getTranslations("pages.tasks");
  const tTaskType = await getTranslations("taskType");

  // Fetch members first to check if current user is an org member
  const members = await getOrgMembersWithNames(orgId);
  const isMember = members.some((m) => m.userId === user.id);

  // Default to "me" only if the current user is an org member, otherwise "all"
  const assigneeParam = rawAssignee ?? (isMember ? "me" : "all");

  const assigneeIdFilter =
    assigneeParam === "all" ? null :
    assigneeParam === "me" ? user.id :
    assigneeParam;

  const [allTasks, overdueCount, todayCount, totalPending, doneThisWeek, interactionStats, brandBriefStatus] =
    await Promise.all([
      getTasksByOrg(orgId, assigneeIdFilter, status),
      countOverdueTasksByOrg(orgId),
      countTodayTasksByOrg(orgId),
      countPendingTasksByOrg(orgId),
      countCompletedTasksThisWeek(orgId),
      getWeeklyInteractionStats(orgId),
      getBrandBriefStatus(orgId),
    ]);

  const memberMap = Object.fromEntries(members.map((m) => [m.userId, m.displayName]));

  const now = new Date();

  // Filter by period tab — drive grouping off the effective date so engine-
  // scheduled tasks (scheduledFor only, no dueAt) land in the right bucket.
  const filteredTasks = allTasks.filter((task) => {
    const group = getTaskGroup(effectiveDate(task), now);
    if (period === "today") return group === "today" || group === "overdue";
    if (period === "week") return group === "tomorrow" || group === "week";
    if (period === "later") return group === "later" || group === "no_date";
    return true;
  });

  // Group tasks
  const groups: Record<TaskGroup, TaskWithContext[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    no_date: [],
  };
  for (const task of filteredTasks) {
    groups[getTaskGroup(effectiveDate(task), now)].push(task);
  }

  const orderedGroups: TaskGroup[] =
    period === "today" ? ["overdue", "today"] :
    period === "week" ? ["tomorrow", "week"] :
    period === "later" ? ["later", "no_date"] :
    ["overdue", "today", "tomorrow", "week", "later", "no_date"];

  const groupLabel: Record<TaskGroup, string> = {
    overdue: t("groups.overdue"),
    today: t("groups.today"),
    tomorrow: t("groups.tomorrow"),
    week: t("groups.week"),
    later: t("groups.later"),
    no_date: t("groups.noDate"),
  };

  const tabs: { key: Period; label: string }[] = [
    { key: "all", label: t("tabs.all") },
    { key: "today", label: t("tabs.today") },
    { key: "week", label: t("tabs.week") },
    { key: "later", label: t("tabs.later") },
  ];

  const subtitle = t("subtitle", { overdue: overdueCount, today: todayCount, total: totalPending });

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-brand-amber font-medium">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <div className="flex items-center rounded-md border border-border bg-background divide-x divide-border">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-secondary text-foreground rounded-l-md"
            >
              <LayoutList className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("views.list")}</span>
            </button>
            <button
              type="button"
              disabled
              title={t("views.kanbanSoon")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("views.kanban")}</span>
            </button>
            <button
              type="button"
              disabled
              title={t("views.calendarSoon")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed rounded-r-md"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("views.calendar")}</span>
            </button>
          </div>
          <Link href="/tasks/new">
            <Button>
              <Plus className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{t("newTask")}</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Tab bar + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <nav className="flex items-center gap-1">
          {tabs.map(({ key, label }) => (
            <Link
              key={key}
              href={buildHref(key, assigneeParam, status)}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                period === key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <FilterSelect
            name="assignee"
            value={assigneeParam}
            params={{ ...(period !== "all" && { period }), ...(status !== "active" && { status }) }}
            options={[
              ...(isMember ? [{ value: "me", label: t("filters.me") }] : []),
              { value: "all", label: t("filters.allMembers") },
              ...members
                .filter((m) => !isMember || m.userId !== user.id)
                .map((m) => ({ value: m.userId, label: m.displayName })),
            ]}
          />

          <FilterSelect
            name="status"
            value={status}
            params={{ ...(period !== "all" && { period }), ...(assigneeParam !== "me" && { assignee: assigneeParam }) }}
            options={[
              { value: "active", label: t("filters.statusActive") },
              { value: "pending", label: t("filters.statusPending") },
              { value: "in_progress", label: t("filters.statusInProgress") },
              { value: "completed", label: t("filters.statusCompleted") },
            ]}
          />

          {[t("filters.type"), t("filters.microZone")].map((label) => (
            <button
              key={label}
              type="button"
              disabled
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {label}
              <ChevronDown className="h-3 w-3" />
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          disabled
          placeholder={t("searchPlaceholder")}
          className="w-full h-9 pl-9 pr-4 rounded-md border border-border bg-background text-sm text-muted-foreground disabled:cursor-not-allowed placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Task groups */}
      {filteredTasks.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {t("empty")}
          {status !== "completed" && (
            <div className="mt-4">
              <Link href="/tasks/new">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-1.5" />
                  {t("newTask")}
                </Button>
              </Link>
            </div>
          )}
        </Card>
      ) : status === "completed" ? (
        // Flat list for completed tasks — no date grouping
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              now={now}
              locale={locale}
              isOverdue={false}
              isCompleted
              tTaskType={tTaskType}
              t={t}
              memberMap={memberMap}
              currentUserId={user.id}
              brandBriefStatus={brandBriefStatus}
              gmailStatus={gmailStatus}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {orderedGroups.map((group) => {
            const groupTasks = groups[group];
            if (groupTasks.length === 0) return null;

            const isOverdue = group === "overdue";
            const isToday = group === "today";
            const dateSuffix = (isToday || isOverdue) ? "" :
              group === "tomorrow" ? formatDueDate(addDays(startOfDay(now), group === "tomorrow" ? 1 : 0), locale) ?? "" : "";

            return (
              <section key={group}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className={cn(
                    "text-xs font-semibold uppercase tracking-widest",
                    isOverdue ? "text-brand-amber" : "text-muted-foreground",
                  )}>
                    {groupLabel[group]}
                    {dateSuffix && (
                      <span className="normal-case tracking-normal font-normal ml-1 capitalize">
                        · {dateSuffix}
                      </span>
                    )}
                    <span className="ml-2 font-normal">({groupTasks.length})</span>
                  </h2>
                  <div className={cn("flex-1 h-px", isOverdue ? "bg-brand-amber/30" : "bg-border")} />
                </div>

                <div className="divide-y divide-border rounded-lg border border-border overflow-hidden bg-card">
                  {groupTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      locale={locale}
                      isOverdue={isOverdue}
                      isCompleted={false}
                      tTaskType={tTaskType}
                      t={t}
                      memberMap={memberMap}
                      currentUserId={user.id}
                      brandBriefStatus={brandBriefStatus}
                      gmailStatus={gmailStatus}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Footer stats */}
      {filteredTasks.length > 0 && (
        <div className="mt-6 py-3 px-4 rounded-md bg-secondary/40 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>{t("footer.doneThisWeek", { count: doneThisWeek })}</span>
          <span className="text-emerald-600">{t("footer.vsLastWeek", { count: 0 })}</span>
          <span>{t("footer.responseRate", { rate: interactionStats.responseRate })}</span>
          <span className="ml-auto">{t("footer.sortedBy")}</span>
        </div>
      )}
    </div>
  );
}

async function TaskRow({
  task,
  now,
  locale,
  isOverdue,
  isCompleted,
  tTaskType,
  t,
  memberMap,
  currentUserId,
  brandBriefStatus,
  gmailStatus,
}: {
  task: TaskWithContext;
  now: Date;
  locale: string;
  isOverdue: boolean;
  isCompleted: boolean;
  tTaskType: Awaited<ReturnType<typeof getTranslations<"taskType">>>;
  t: Awaited<ReturnType<typeof getTranslations<"pages.tasks">>>;
  memberMap: Record<string, string>;
  currentUserId: string;
  brandBriefStatus: BrandBriefStatus;
  gmailStatus: { connected: boolean; address: string | null };
}) {
  const tMessages = await getTranslations("pages.messages");

  // Compute the optional generate context iff the task is message-eligible.
  const messageDefaults = task.contact
    ? getMessageDefaultsFromTask({ type: task.type, contactId: task.contact.id })
    : null;
  const generateCtx: TaskGenerateContext | undefined =
    messageDefaults && task.contact && task.company
      ? {
          contactDisplayName: resolveContactDisplayName(task.contact),
          companyDisplayName: task.company.name,
          contactFirstName: task.contact.firstName,
          contactLastName: task.contact.lastName,
          contactJobTitle: task.contact.jobTitle,
          defaultChannelIntent: messageDefaults.channelIntent,
          defaultLocale: getMessageDefaultLocale(task.contact.preferredLanguage),
          preferredLocaleHint: tMessages("fields.languageHint", {
            contact: resolveContactDisplayName(task.contact),
          }),
          detectedSignal: getDetectedSignalProp(
            task.company.signalType,
            task.company.signalDetectedAt,
          ),
          brandBriefStatus,
          gmail: gmailStatus,
          // Sprint 12 — surface the sequence context only for
          // sequence-driven tasks ; otherwise the dialog hides the
          // scope toggle.
          sequenceContext: task.sequenceEnrolment?.sequence
            ? {
                sequenceName: task.sequenceEnrolment.sequence.name,
                resolvedScope:
                  task.sequenceEnrolment.sequence.messageContextScope === "all"
                    ? ("all" as const)
                    : ("sequence" as const),
              }
            : undefined,
          // Sprint 12 phase 3 — route to SendDefinedMessageDialog when
          // the source step is in `defined` mode (no LLM call).
          sourceStepMode: task.sourceStepMode ?? null,
        }
      : undefined;

  const { Icon, bg } = taskTypeIcon(task.type);
  const grade = scoreGrade(task.company?.score);
  const overdueDays = isOverdue && task.dueAt ? daysDiff(task.dueAt, now) : 0;

  const typeLabel = tTaskType(task.type as Parameters<typeof tTaskType>[0]);

  const signalText = task.company?.signalType
    ? t("signalPrefix", { signal: task.company.signalType })
    : task.description ?? null;

  const assigneeName = task.assigneeId
    ? (task.assigneeId === currentUserId ? t("assigneeMe") : memberMap[task.assigneeId] ?? "—")
    : null;

  const safeStatus = (["pending", "in_progress", "completed"].includes(task.status)
    ? task.status
    : "pending") as "pending" | "in_progress" | "completed";

  const statusBadge: Record<typeof safeStatus, { label: string; className: string }> = {
    pending:     { label: t("actions.pending"),    className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
    in_progress: { label: t("actions.inProgress"), className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    completed:   { label: t("actions.completed"),  className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  };

  return (
    <div className={cn(
      "flex items-start gap-3 px-4 py-3.5 hover:bg-secondary/20",
      isCompleted && "opacity-70",
    )}>
      {/* Type icon */}
      <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0", bg)}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <Link
            href={`/tasks/${task.id}`}
            className={cn(
              "text-sm font-medium hover:underline",
              isOverdue ? "text-brand-amber" : "text-foreground",
              isCompleted && "line-through text-muted-foreground",
            )}
          >
            {typeLabel} · {task.title}
          </Link>

          {task.company?.score != null && grade && (
            <span className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium",
              scoreBadgeClasses(task.company.score),
            )}>
              {task.company.score} · {grade}
            </span>
          )}

          {isOverdue && overdueDays > 0 && (
            <span className="text-xs text-brand-amber">
              · {t("overdueBadge", { days: overdueDays })}
            </span>
          )}

          {isCompleted && task.completedAt && (
            <span className="text-xs text-emerald-600">
              ✓ {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(task.completedAt)}
            </span>
          )}
          {!isOverdue && !isCompleted && effectiveDate(task) && (
            <span className="text-xs text-muted-foreground">
              · {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(effectiveDate(task)!)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span>
            {task.company && (
              <Link href={`/companies/${task.company.id}`} className="font-semibold hover:text-brand-teal">
                {task.company.name}
              </Link>
            )}
            {task.contact && (
              <span className="text-muted-foreground">
                {" "}—{" "}
                <Link href={`/contacts/${task.contact.id}`} className="hover:text-brand-teal">
                  {resolveContactDisplayName(task.contact)}
                </Link>
                {task.contact.jobTitle && `, ${task.contact.jobTitle}`}
              </span>
            )}
          </span>

          {assigneeName && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              {assigneeName}
            </span>
          )}
        </div>

        {signalText && (
          <div className="text-xs text-muted-foreground mt-0.5">{signalText}</div>
        )}

        {/* Sprint 12 phase 4 — agent auto-execution flag. Two states the
            sale needs to see :
              - succeeded : the agent already sent ; the row is in the
                "completed" list (status flips before this badge is
                evaluated). No badge needed.
              - failed : agent tried + failed (no Gmail, LLM error…).
                Show the reason so the sale knows to take over. */}
        {task.autoExecutionStatus === "failed" && (
          <div
            className="mt-1 inline-flex max-w-full items-start gap-1.5 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700"
            title={task.autoExecutionError ?? undefined}
          >
            <span className="font-semibold">{t("agentAutoExecFailedBadge")}</span>
            {task.autoExecutionError && (
              <span className="truncate">{task.autoExecutionError}</span>
            )}
          </div>
        )}
        {task.autoExecutionStatus === "pending" && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">
            {t("agentAutoExecPendingBadge")}
          </div>
        )}

        {task.sequenceEnrolment?.sequence && (
          <Link
            href={`/sequences/${task.sequenceEnrolment.sequence.id}/enrolments/${task.sequenceEnrolment.id}`}
            className="mt-1 inline-flex items-center gap-1.5 rounded bg-brand-teal/10 px-1.5 py-0.5 text-[11px] text-brand-teal hover:bg-brand-teal/20"
          >
            <Workflow className="h-3 w-3" />
            <span className="truncate">
              {task.sequenceEnrolment.sequence.name}
              {task.sequenceEnrolment.sequence.steps.length > 0 &&
                ` · ${t("sequenceStepBadge", {
                  // Display the step that CREATED this task — not the
                  // enrolment cursor (engine has already advanced when
                  // the task is hanging open). Falls back to the cursor
                  // when the source step lookup didn't find one
                  // (defensive : shouldn't happen for sequence-driven tasks).
                  current:
                    (task.sourceStepOrder ?? task.sequenceEnrolment.currentStepOrder) + 1,
                  total: task.sequenceEnrolment.sequence.steps.length,
                })}`}
            </span>
          </Link>
        )}
      </div>

      {/* Status badge */}
      <span className={cn(
        "inline-flex items-center shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium",
        statusBadge[safeStatus].className,
      )}>
        {statusBadge[safeStatus].label}
      </span>

      <TaskRowActions
        taskId={task.id}
        currentStatus={safeStatus}
        companyId={task.company?.id ?? null}
        companyName={task.company?.name ?? null}
        contactId={task.contact?.id ?? null}
        generate={generateCtx}
        labels={{
          statusSection: t("actions.statusSection"),
          pending: t("actions.pending"),
          inProgress: t("actions.inProgress"),
          completed: t("actions.completed"),
          logInteraction: t("actions.logInteraction"),
          generateMessage: tMessages("actions.fromTask"),
          sendDefinedMessage: tMessages("actions.sendDefinedMessage"),
          edit: t("actions.edit"),
          delete: t("actions.delete"),
        }}
      />
    </div>
  );
}

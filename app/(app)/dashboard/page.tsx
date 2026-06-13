import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Mail, Phone, CheckCircle2, TrendingUp, Flame, AlertCircle, MapPin, Calendar, Search, Inbox, Clock, Bot, Send, CalendarClock } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { formatDateInTz } from "@/lib/i18n/format-date";
import {
  getTasksDashboard,
  getThisWeekTasksDashboard,
  getNextWeekTasksDashboard,
  countTodayTasksByOrg,
  countOverdueTasksByOrg,
  getOldestOverdueTaskAgeDays,
  getAgentDashboardStats,
} from "@/db/queries/tasks";
import {
  getRecentInteractionsByOrg,
  countRepliesToClassifyByOrg,
  countAwaitingReplyByOrg,
  getResponseRateLast30Days,
  getOutboundChannelsLast7Days,
} from "@/db/queries/interactions";
import { ChannelDonut, type ChannelDonutSlice } from "@/components/app/dashboard/channel-donut";
import { listCompaniesByOrg } from "@/db/queries/companies";
import { scoreGrade, scoreBadgeClasses } from "@/lib/scoring/grade";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const HOT_TARGET_SCORE_THRESHOLD = 70;

function taskIcon(type: string) {
  switch (type) {
    case "email":
    case "follow_up": return Mail;
    case "phone": return Phone;
    case "visit": return MapPin;
    case "meeting": return Calendar;
    case "research": return Search;
    default: return CheckCircle2;
  }
}

function interactionOutcomeClasses(outcome: string | null) {
  switch (outcome) {
    case "positive_reply":
    case "rdv_scheduled": return "bg-emerald-50 text-emerald-700";
    case "negative_reply":
    case "opted_out": return "bg-rose-50 text-rose-700";
    default: return "bg-amber-50 text-amber-700";
  }
}

export default async function DashboardPage() {
  const { user, activeOrganization, userTimezone } = await getActiveOrg();
  const locale = await getLocale();
  const t = await getTranslations("pages.dashboard");
  const tTasks = await getTranslations("pages.tasks");
  const tTaskType = await getTranslations("taskType");
  const tInteractionType = await getTranslations("interactionType");
  const tInteractionChannel = await getTranslations("interactionChannel");
  const tInteractionOutcome = await getTranslations("interactionOutcome");
  const tScoring = await getTranslations("scoring");

  const orgId = activeOrganization.id;

  const [
    todayTasks,
    thisWeekTasks,
    nextWeekTasks,
    recentInteractions,
    actionsToday,
    overdueCount,
    oldestOverdueDays,
    topCompanies,
    responseStats,
    repliesToClassify,
    awaitingReply,
    agentStats,
    channelStats,
  ] = await Promise.all([
    getTasksDashboard(orgId, user.id),
    getThisWeekTasksDashboard(orgId, user.id),
    getNextWeekTasksDashboard(orgId, user.id),
    getRecentInteractionsByOrg(orgId, 5),
    countTodayTasksByOrg(orgId, user.id),
    countOverdueTasksByOrg(orgId, user.id),
    getOldestOverdueTaskAgeDays(orgId, user.id),
    listCompaniesByOrg(orgId),
    getResponseRateLast30Days(orgId),
    countRepliesToClassifyByOrg(orgId),
    countAwaitingReplyByOrg(orgId, user.id),
    getAgentDashboardStats(orgId, user.id),
    getOutboundChannelsLast7Days(orgId, user.id),
  ]);

  // Sprint 12 phase 5 — donut data. Colors picked to match the existing
  // palette : brand-teal for email (the workhorse), sky for LinkedIn,
  // amber for phone (warm/urgent), emerald for visit (field signal),
  // muted for other. Strings translated via tInteractionChannel.
  const channelSlices: ChannelDonutSlice[] = [
    { key: "email",    label: tInteractionChannel("email"),    count: channelStats.email,    color: "#0d9488" },
    { key: "linkedin", label: tInteractionChannel("linkedin"), count: channelStats.linkedin, color: "#0284c7" },
    { key: "phone",    label: tInteractionChannel("phone"),    count: channelStats.phone,    color: "#f59e0b" },
    { key: "visit",    label: tInteractionChannel("in_person"), count: channelStats.visit,   color: "#10b981" },
    { key: "other",    label: tInteractionChannel("other"),    count: channelStats.other,    color: "#94a3b8" },
  ];

  // listCompaniesByOrg already orders by score DESC, signal_detected_at DESC NULLS LAST
  const topTargets = topCompanies
    .filter((c) => c.score != null)
    .slice(0, 4);

  const hotTargetsCount = topCompanies.filter(
    (c) => c.score != null && c.score >= HOT_TARGET_SCORE_THRESHOLD,
  ).length;

  const localPart = user.email?.split("@")[0] ?? "";
  const firstName = localPart.charAt(0).toUpperCase() + localPart.slice(1);

  const today = new Date();
  const dateFormatted = formatDateInTz(today, locale, {
    timeZone: userTimezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Response-rate detail: two lines — delta vs prior 30d, then the absolute volume
  // (X réponses / Y envois) so the user can sanity-check the rate against the
  // sample size (a "100%" off 1 envoi reads very differently from 100% off 50).
  let deltaLine: React.ReactNode;
  if (responseStats.deltaPoints == null) {
    deltaLine = t("kpis.responseRateDeltaNoData");
  } else if (responseStats.deltaPoints > 0) {
    deltaLine = (
      <span className="text-emerald-600">
        {t("kpis.responseRateDeltaUp", { points: responseStats.deltaPoints })}
      </span>
    );
  } else if (responseStats.deltaPoints < 0) {
    deltaLine = (
      <span className="text-rose-600">
        {t("kpis.responseRateDeltaDown", { points: Math.abs(responseStats.deltaPoints) })}
      </span>
    );
  } else {
    deltaLine = t("kpis.responseRateDeltaFlat");
  }
  const responseRateDetailNode = (
    <>
      <div>{deltaLine}</div>
      <div className="text-[11px] text-muted-foreground/80">
        {t("kpis.responseRateVolume", {
          responded: responseStats.responded,
          sent: responseStats.sent,
        })}
      </div>
    </>
  );

  return (
    <div className="max-w-[1400px] mx-auto">
      <header className="mb-10">
        <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight">
          {t("greeting", { name: firstName })} <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich("subtitle", {
            date: dateFormatted,
            actions: actionsToday,
            em: (chunks) =>
              actionsToday > 0 ? (
                <a href="#today-tasks" className="text-brand-amber font-medium hover:underline">
                  {chunks}
                </a>
              ) : (
                <span className="text-brand-amber font-medium">{chunks}</span>
              ),
          })}
        </p>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        <KpiCard
          label={t("kpis.actionsToday")}
          value={actionsToday}
          detail={t("kpis.actionsTodayDetail", {
            emails: todayTasks.filter((tk) => tk.type === "email").length,
            calls: todayTasks.filter((tk) => tk.type === "phone").length,
            visits: todayTasks.filter((tk) => tk.type === "visit").length,
          })}
          icon={<CheckCircle2 className="h-4 w-4 text-brand-teal" />}
        />
        <KpiCard
          label={t("kpis.overdue")}
          value={overdueCount}
          detail={
            oldestOverdueDays > 0
              ? t("kpis.overdueDetail", { days: oldestOverdueDays })
              : t("kpis.overdueDetailNone")
          }
          icon={<AlertCircle className="h-4 w-4 text-brand-amber" />}
          highlight={overdueCount > 0}
        />
        <KpiCard
          label={t("kpis.repliesToClassify")}
          value={repliesToClassify}
          detail={
            repliesToClassify > 0
              ? t("kpis.repliesToClassifyDetail")
              : t("kpis.repliesToClassifyDetailNone")
          }
          icon={<Inbox className="h-4 w-4 text-brand-teal" />}
          highlight={repliesToClassify > 0}
        />
        <KpiCard
          label={t("kpis.hotTargets")}
          value={hotTargetsCount}
          detail={t("kpis.hotTargetsDetail", { threshold: HOT_TARGET_SCORE_THRESHOLD })}
          icon={<Flame className="h-4 w-4 text-brand-amber" />}
        />
        <KpiCard
          label={t("kpis.awaitingReply")}
          value={awaitingReply}
          detail={t("kpis.awaitingReplyDetail")}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        />
        <KpiCard
          label={t("kpis.responseRate")}
          value={`${responseStats.rate}%`}
          detail={responseRateDetailNode}
          icon={<TrendingUp className="h-4 w-4 text-brand-teal" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Sprint 12 phase 5 — three task-list cards stacked in the main
            column : today, this week, next week. Each card mirrors the
            other two so the sale's eye reads the same vertical pattern
            (header + list of rows). The row markup is duplicated inline
            on purpose — extracting it to a helper means passing the
            three i18n translators down and gains very little, while
            the duplicated JSX stays cheap to scan. */}
        <div className="flex flex-col gap-6">
        {/* Today's tasks — anchored so the "X actions vous attendent" subtitle
            link above can scroll the user straight to this section. */}
        <Card id="today-tasks" className="p-6 scroll-mt-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <h2 className="font-serif text-2xl font-bold">{t("today.title")}</h2>
            <Link href="/tasks" className="text-sm text-brand-teal hover:underline shrink-0">
              {t("today.viewAll")} →
            </Link>
          </div>

          {todayTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              {t("today.empty")}{" "}
              <Link href="/tasks/new" className="text-brand-teal hover:underline">
                {t("today.emptyAction")}
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {todayTasks.map((task) => {
                const Icon = taskIcon(task.type);
                const isOverdue = task.dueAt && task.dueAt < new Date(new Date().setHours(0, 0, 0, 0));
                const grade = scoreGrade(task.company?.score);
                const typeLabel = tTaskType(task.type as Parameters<typeof tTaskType>[0]);
                return (
                  <li key={task.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
                      <Icon className={cn("h-4 w-4 shrink-0", isOverdue ? "text-brand-amber" : "text-muted-foreground")} />
                      <Link href={`/tasks/${task.id}`} className={cn("font-semibold hover:text-brand-teal hover:underline", isOverdue ? "text-brand-amber" : "text-foreground")}>
                        {typeLabel} — {task.title}
                      </Link>
                      {task.company?.score != null && grade && (
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium", scoreBadgeClasses(task.company.score))}>
                          {tScoring("scoreBadge", { score: task.company.score, grade })}
                        </span>
                      )}
                    </div>
                    {task.company && (
                      <div className="text-xs text-muted-foreground pl-6">
                        <Link href={`/companies/${task.company.id}`} className="font-medium text-foreground hover:text-brand-teal">{task.company.name}</Link>
                        {task.contact && (<>{" — "}<Link href={`/contacts/${task.contact.id}`} className="hover:text-brand-teal">{resolveContactDisplayName(task.contact)}</Link>{task.contact.jobTitle && `, ${task.contact.jobTitle}`}</>)}
                      </div>
                    )}
                    {task.company?.signalType && (
                      <div className="text-xs text-muted-foreground/80 pl-6 mt-0.5">{tTasks("signalPrefix", { signal: task.company.signalType })}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* This week (excludes today) */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <h2 className="font-serif text-2xl font-bold">{t("thisWeek.title")}</h2>
            <Link href="/tasks" className="text-sm text-brand-teal hover:underline shrink-0">{t("today.viewAll")} →</Link>
          </div>
          {thisWeekTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t("thisWeek.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {thisWeekTasks.map((task) => {
                const Icon = taskIcon(task.type);
                const grade = scoreGrade(task.company?.score);
                const typeLabel = tTaskType(task.type as Parameters<typeof tTaskType>[0]);
                return (
                  <li key={task.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Link href={`/tasks/${task.id}`} className="font-semibold text-foreground hover:text-brand-teal hover:underline">
                        {typeLabel} — {task.title}
                      </Link>
                      {task.company?.score != null && grade && (
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium", scoreBadgeClasses(task.company.score))}>
                          {tScoring("scoreBadge", { score: task.company.score, grade })}
                        </span>
                      )}
                    </div>
                    {task.company && (
                      <div className="text-xs text-muted-foreground pl-6">
                        <Link href={`/companies/${task.company.id}`} className="font-medium text-foreground hover:text-brand-teal">{task.company.name}</Link>
                        {task.contact && (<>{" — "}<Link href={`/contacts/${task.contact.id}`} className="hover:text-brand-teal">{resolveContactDisplayName(task.contact)}</Link>{task.contact.jobTitle && `, ${task.contact.jobTitle}`}</>)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Next week (+8 to +14) */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <h2 className="font-serif text-2xl font-bold">{t("nextWeek.title")}</h2>
            <Link href="/tasks" className="text-sm text-brand-teal hover:underline shrink-0">{t("today.viewAll")} →</Link>
          </div>
          {nextWeekTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t("nextWeek.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {nextWeekTasks.map((task) => {
                const Icon = taskIcon(task.type);
                const grade = scoreGrade(task.company?.score);
                const typeLabel = tTaskType(task.type as Parameters<typeof tTaskType>[0]);
                return (
                  <li key={task.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Link href={`/tasks/${task.id}`} className="font-semibold text-foreground hover:text-brand-teal hover:underline">
                        {typeLabel} — {task.title}
                      </Link>
                      {task.company?.score != null && grade && (
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium", scoreBadgeClasses(task.company.score))}>
                          {tScoring("scoreBadge", { score: task.company.score, grade })}
                        </span>
                      )}
                    </div>
                    {task.company && (
                      <div className="text-xs text-muted-foreground pl-6">
                        <Link href={`/companies/${task.company.id}`} className="font-medium text-foreground hover:text-brand-teal">{task.company.name}</Link>
                        {task.contact && (<>{" — "}<Link href={`/contacts/${task.contact.id}`} className="hover:text-brand-teal">{resolveContactDisplayName(task.contact)}</Link>{task.contact.jobTitle && `, ${task.contact.jobTitle}`}</>)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* Sprint 12 phase 5 — Agent block. Three stats : what's
              scheduled today, what shipped this week, and what failed
              (the actionable one — linkable to a filtered task list). */}
          <Card className="p-6">
            <h2 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
              <Bot className="h-4 w-4 text-sky-600" />
              {t("agent.title")}
            </h2>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  {t("agent.pendingToday")}
                </span>
                <span className="font-serif text-lg font-bold tabular-nums">
                  {agentStats.pendingToday}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  {t("agent.pendingThisWeek")}
                </span>
                <span className="font-serif text-lg font-bold tabular-nums">
                  {agentStats.pendingThisWeek}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  {t("agent.pendingTotal")}
                </span>
                <span className="font-serif text-lg font-bold tabular-nums">
                  {agentStats.pendingTotal}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Send className="h-4 w-4 shrink-0" />
                  {t("agent.succeededLast7Days")}
                </span>
                <span className="font-serif text-lg font-bold tabular-nums">
                  {agentStats.succeededLast7Days}
                </span>
              </li>
              {agentStats.failedToTakeOver > 0 ? (
                <li>
                  <Link
                    href="/tasks?status=agent_failed"
                    className="flex items-center justify-between gap-3 rounded-md bg-rose-50 px-2 py-1.5 -mx-2 hover:bg-rose-100 transition-colors"
                  >
                    <span className="inline-flex items-center gap-2 text-rose-700">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {t("agent.failedToTakeOver")}
                    </span>
                    <span className="font-serif text-lg font-bold text-rose-700 tabular-nums">
                      {agentStats.failedToTakeOver}
                    </span>
                  </Link>
                </li>
              ) : (
                <li className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {t("agent.failedToTakeOver")}
                  </span>
                  <span className="font-serif text-lg font-bold tabular-nums text-muted-foreground">
                    0
                  </span>
                </li>
              )}
            </ul>
          </Card>

          {/* Sprint 12 phase 5 — Channel donut. The Léon & George wedge
              is "digital + field" — this surfaces the balance at a
              glance. A sale doing 95% email gets a clear nudge. */}
          <Card className="p-6">
            <h2 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-brand-teal" />
              {t("channelDonut.title")}
            </h2>
            <ChannelDonut
              slices={channelSlices}
              totalLabel={t("channelDonut.totalLabel")}
              emptyLabel={t("channelDonut.empty")}
            />
          </Card>

          {/* Top targets */}
          <Card className="p-6">
            <h2 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
              <Flame className="h-4 w-4 text-brand-amber" />
              {t("topTargets.title")}
            </h2>
            {topTargets.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("topTargets.empty")}</p>
            ) : (
              <ul className="space-y-3">
                {topTargets.map((target) => {
                  const grade = scoreGrade(target.score);
                  return (
                    <li key={target.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/companies/${target.id}`} className="text-sm font-medium truncate block hover:text-brand-teal">
                          {target.name}
                        </Link>
                        {target.signalType && (
                          <div className="text-xs text-muted-foreground truncate">{target.signalType}</div>
                        )}
                      </div>
                      {target.score != null && grade && (
                        <span className={cn(
                          "shrink-0 inline-flex items-center justify-center w-9 h-6 rounded text-xs font-medium",
                          scoreBadgeClasses(target.score),
                        )}>
                          {target.score}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Recent activity */}
          <Card className="p-6">
            <h2 className="font-serif text-lg font-bold mb-3">
              {t("recentActivity.title")}
            </h2>
            {recentInteractions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("recentActivity.empty")}</p>
            ) : (
              <ul className="space-y-3">
                {recentInteractions.map((interaction) => (
                  <li key={interaction.id} className="text-xs">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">
                          {tInteractionType(interaction.type as Parameters<typeof tInteractionType>[0])}
                        </span>
                        <span className="text-muted-foreground">
                          {" · "}{tInteractionChannel(interaction.channel as Parameters<typeof tInteractionChannel>[0])}
                        </span>
                        {interaction.contact && (
                          <span className="text-muted-foreground">
                            {" — "}{resolveContactDisplayName(interaction.contact)}
                          </span>
                        )}
                        {interaction.company && (
                          <div className="text-muted-foreground truncate">
                            {interaction.company.name}
                          </div>
                        )}
                        {interaction.outcome && (
                          <span className={cn(
                            "inline-flex mt-0.5 px-1 py-0.5 rounded text-[10px] font-medium",
                            interactionOutcomeClasses(interaction.outcome),
                          )}>
                            {tInteractionOutcome(interaction.outcome as Parameters<typeof tInteractionOutcome>[0])}
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground shrink-0">
                        {formatDateInTz(interaction.occurredAt, locale, { timeZone: userTimezone, dateStyle: "short" })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  icon,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(
      "p-5",
      highlight && "ring-1 ring-brand-amber/60 bg-amber-50/40",
    )}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
          {label}
        </div>
        {icon}
      </div>
      <div className="font-serif text-4xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5">{detail}</div>
    </Card>
  );
}

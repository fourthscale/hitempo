import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Mail, RefreshCcw, Phone, CheckCircle2, TrendingUp, Flame, AlertCircle, MapPin, Calendar, Search } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { getTasksDashboard, countTodayTasksByOrg, countOverdueTasksByOrg } from "@/db/queries/tasks";
import { getRecentInteractionsByOrg, getWeeklyInteractionStats } from "@/db/queries/interactions";
import { listCompaniesByOrg } from "@/db/queries/companies";
import { scoreGrade, scoreBadgeClasses } from "@/lib/scoring/grade";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// KPIs that stay mocked until sprint 06
const PLACEHOLDER_SPRINT06 = {
  weekNumber: 21,
  microZone: "Opéra / Auber",
  newProspects: 12,
  hotTargets: 12,
  responsePoints: 4,
} as const;

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
  const { user, activeOrganization } = await getActiveOrg();
  const locale = await getLocale();
  const t = await getTranslations("pages.dashboard");
  const tTasks = await getTranslations("pages.tasks");
  const tTaskType = await getTranslations("taskType");
  const tInteractionType = await getTranslations("interactionType");
  const tInteractionChannel = await getTranslations("interactionChannel");
  const tInteractionOutcome = await getTranslations("interactionOutcome");

  const orgId = activeOrganization.id;

  const [
    todayTasks,
    recentInteractions,
    actionsToday,
    overdueCount,
    topCompanies,
    interactionStats,
  ] = await Promise.all([
    getTasksDashboard(orgId, user.id),
    getRecentInteractionsByOrg(orgId, 5),
    countTodayTasksByOrg(orgId, user.id),
    countOverdueTasksByOrg(orgId, user.id),
    listCompaniesByOrg(orgId),
    getWeeklyInteractionStats(orgId),
  ]);

  // listCompaniesByOrg already orders by score DESC, signal_detected_at DESC NULLS LAST
  const topTargets = topCompanies
    .filter((c) => c.score != null)
    .slice(0, 4);

  const localPart = user.email?.split("@")[0] ?? "";
  const firstName = localPart.charAt(0).toUpperCase() + localPart.slice(1);

  const today = new Date();
  const dateFormatted = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(today);

  // Oldest overdue task age in days
  const oldestOverdueDays = 0; // placeholder until sprint 06 computes it properly

  return (
    <div className="max-w-[1400px] mx-auto">
      <header className="flex items-start justify-between gap-8 mb-10">
        <div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold tracking-tight">
            {t("greeting", { name: firstName })} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t.rich("subtitle", {
              date: dateFormatted,
              actions: actionsToday,
              em: (chunks) => <span className="text-brand-amber font-medium">{chunks}</span>,
            })}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm text-muted-foreground">
            {t("sideHeader", {
              week: PLACEHOLDER_SPRINT06.weekNumber,
              zone: PLACEHOLDER_SPRINT06.microZone,
            })}
          </div>
          <a href="#" className="text-sm text-brand-teal hover:underline mt-1 inline-block">
            {t("sideSubheader", { count: PLACEHOLDER_SPRINT06.newProspects })}
          </a>
        </div>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
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
          detail={t("kpis.overdueDetail", { days: oldestOverdueDays || 1 })}
          icon={<AlertCircle className="h-4 w-4 text-brand-amber" />}
          highlight={overdueCount > 0}
        />
        <KpiCard
          label={t("kpis.hotTargets")}
          value={PLACEHOLDER_SPRINT06.hotTargets}
          detail={t("kpis.hotTargetsDetail")}
          icon={<Flame className="h-4 w-4 text-brand-amber" />}
        />
        <KpiCard
          label={t("kpis.responseRate")}
          value={`${interactionStats.responseRate}%`}
          detail={
            <span className="text-emerald-600">
              ↑ {t("kpis.responseRateDetail", { points: PLACEHOLDER_SPRINT06.responsePoints })}
            </span>
          }
          icon={<TrendingUp className="h-4 w-4 text-brand-teal" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Today's tasks */}
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="font-serif text-2xl font-bold">{t("today.title")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t("today.sortHint")}</p>
            </div>
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
                    <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5">
                      <Icon className={cn(
                        "h-4 w-4",
                        isOverdue ? "text-brand-amber" : "text-muted-foreground",
                      )} />
                      <span className={cn(
                        "font-medium",
                        isOverdue ? "text-brand-amber" : "text-foreground",
                      )}>
                        {typeLabel} — {task.title}
                      </span>
                      {task.type === "follow_up" && (
                        <RefreshCcw className="h-3 w-3 text-brand-amber" aria-hidden />
                      )}
                      {task.company?.score != null && grade && (
                        <span className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium",
                          scoreBadgeClasses(task.company.score),
                        )}>
                          Score {task.company.score} · {grade}
                        </span>
                      )}
                    </div>
                    {task.company && (
                      <div className="text-sm">
                        <Link href={`/companies/${task.company.id}`} className="font-semibold hover:text-brand-teal">
                          {task.company.name}
                        </Link>
                        {task.contact && (
                          <span className="text-muted-foreground">
                            {" — "}
                            <Link href={`/contacts/${task.contact.id}`} className="hover:text-brand-teal">
                              {task.contact.firstName} {task.contact.lastName}
                            </Link>
                            {task.contact.jobTitle && `, ${task.contact.jobTitle}`}
                          </span>
                        )}
                      </div>
                    )}
                    {task.company?.signalType && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {tTasks("signalPrefix", { signal: task.company.signalType })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
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
                            {" — "}{interaction.contact.firstName} {interaction.contact.lastName}
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
                        {new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(
                          new Date(interaction.occurredAt),
                        )}
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

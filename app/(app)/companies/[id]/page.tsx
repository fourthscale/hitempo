import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import {
  Phone,
  ListChecks,
  Sparkles,
  Pencil,
  Trash2,
  Plus,
  Mail,
  Building2,
} from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { formatDateInTz } from "@/lib/i18n/format-date";
import { resolveCompanyTimezone } from "@/lib/i18n/timezones";
import { getCompanyWithDetails, getGroupStats } from "@/db/queries/companies";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { getInteractionsByCompany, countInteractionsByCompany } from "@/db/queries/interactions";
import { getTasksByCompany, countTasksByCompany } from "@/db/queries/tasks";
import {
  deleteCompanyAction,
  setPrimaryContactAction,
} from "@/lib/actions/companies";
import { logInteractionAction } from "@/lib/actions/interactions";
import { recomputeCompanyScoreAction } from "@/lib/actions/scoring";
import { LogInteractionForm } from "@/components/app/log-interaction-form";
import {
  scoreGrade,
  scoreBadgeClasses,
  initialsFromName,
} from "@/lib/scoring/grade";
import type { ScoreBreakdown } from "@/lib/scoring/compute";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { CompanyTabs } from "@/components/app/company-tabs";
import { SitesSection } from "@/components/app/sites-section";
import { PageHeader } from "@/components/app/page-header";
import { PrimaryContactDialog } from "@/components/app/primary-contact-dialog";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { cn } from "@/lib/utils";

function ScoreBreakdownRows({
  breakdown,
  locale,
  userTimezone,
  labels,
}: {
  breakdown: ScoreBreakdown;
  locale: string;
  userTimezone: string;
  labels: { standing: string; signal: string; engagement: string; tasks: string; contact: string; computedAt: string };
}) {
  const rows = [
    { key: "standing",   label: labels.standing,   pts: breakdown.standing.pts,   max: breakdown.standing.max },
    { key: "signal",     label: labels.signal,     pts: breakdown.signal.pts,     max: breakdown.signal.max },
    { key: "engagement", label: labels.engagement, pts: breakdown.engagement.pts, max: breakdown.engagement.max },
    { key: "tasks",      label: labels.tasks,      pts: breakdown.tasks.pts,      max: breakdown.tasks.max },
    { key: "contact",    label: labels.contact,    pts: breakdown.contact.pts,    max: breakdown.contact.max },
  ];
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-foreground/80">{row.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {row.pts} / {row.max}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-teal"
              style={{ width: `${Math.round((row.max > 0 ? row.pts / row.max : 0) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground pt-1">
        {labels.computedAt}:{" "}
        {formatDateInTz(breakdown.computedAt, locale, { timeZone: userTimezone, dateStyle: "medium", timeStyle: "short" })}
      </p>
    </div>
  );
}

type Tab = "overview" | "sites" | "contacts" | "tasks" | "interactions";
const TABS = new Set<Tab>(["overview", "sites", "contacts", "tasks", "interactions"]);
function parseTab(raw: string | undefined): Tab {
  return raw && (TABS as Set<string>).has(raw) ? (raw as Tab) : "overview";
}

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);
  const { activeOrganization, userTimezone } = await getActiveOrg();
  const company = await getCompanyWithDetails(activeOrganization.id, id);
  if (!company) notFound();

  const [t, tCompanyStatus, tRelationship, tScoring, locale] = await Promise.all([
    getTranslations("pages.companies"),
    getTranslations("companyStatus"),
    getTranslations("companyRelationshipType"),
    getTranslations("scoring"),
    getLocale(),
  ]);
  const grade = scoreGrade(company.score);
  const initials = initialsFromName(company.name);

  // Resolve the account owner's display name.
  const members = await getOrgMembersWithNames(activeOrganization.id);
  const ownerName = company.ownerId
    ? (members.find((m) => m.userId === company.ownerId)?.displayName ?? null)
    : null;

  // primarySite: NOT a fallback to "first one" — must be explicitly flagged primary.
  const primarySite = company.sites.find((s) => s.isPrimary) ?? null;

  // primaryContact comes from companies.primary_contact_id (explicit).
  const primaryContact = company.primaryContactId
    ? company.contacts.find((c) => c.id === company.primaryContactId) ?? null
    : null;

  // Group: only show the card if a real group exists (parent OR children).
  const hasParent = Boolean(company.parent);
  const hasChildren = company.children.length > 0;
  const hasGroup = hasParent || hasChildren;
  const groupRoot = company.parent ?? company;
  const [groupStats, interactionsCount, tasksCount] = await Promise.all([
    hasGroup ? getGroupStats(activeOrganization.id, groupRoot.id) : null,
    countInteractionsByCompany(activeOrganization.id, company.id),
    countTasksByCompany(activeOrganization.id, company.id),
  ]);

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Breadcrumb */}
      <nav className="text-xs text-muted-foreground mb-4">
        <Link href="/companies" className="hover:text-foreground">{t("breadcrumb")}</Link>
        {" / "}
        <span className="text-foreground">{company.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <div className="h-12 w-12 sm:h-16 sm:w-16 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center text-base sm:text-xl font-serif font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="font-serif text-2xl md:text-4xl font-bold tracking-tight break-words">
              {company.name}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              {company.industry && <span>{company.industry}</span>}
              {company.standing != null && (
                <span>{"★".repeat(company.standing)} ({company.standing} {t("stars")})</span>
              )}
              {company.sizeEstimate && (
                <span>· {company.sizeEstimate} {t("employees")}</span>
              )}
              {primarySite?.city && <span>· {primarySite.city}</span>}
              {company.websiteUrl && (
                <span>
                  ·{" "}
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-teal hover:underline"
                  >
                    {company.websiteUrl.replace(/^https?:\/\//, "")}
                  </a>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-3">
              {company.score != null && grade && (
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                    scoreBadgeClasses(company.score),
                  )}
                >
                  {tScoring("scoreBadge", { score: company.score, grade })}
                </span>
              )}
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-muted-foreground">
                {tCompanyStatus(company.status as Parameters<typeof tCompanyStatus>[0])}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <Button variant="outline" size="sm" disabled title={t("actions.soon")}>
            <Phone className="h-3.5 w-3.5 mr-1.5" />
            {t("actions.call")}
          </Button>
          <Button variant="outline" size="sm" disabled title={t("actions.tasksSoon")}>
            <ListChecks className="h-3.5 w-3.5 mr-1.5" />
            {t("actions.task")}
          </Button>
          <Button variant="outline" size="sm" disabled title={t("actions.aiSoon")}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            {t("actions.aiMessage")}
          </Button>
          <Link href={`/companies/${company.id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {t("edit")}
            </Button>
          </Link>
          <form action={deleteCompanyAction}>
            <input type="hidden" name="id" value={company.id} />
            <SubmitButton variant="outline" size="sm" className="text-red-600 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t("delete")}
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* Signal banner */}
      {company.signalType && (
        <div className="bg-brand-amber/10 border border-brand-amber/40 rounded-lg p-4 mb-6">
          <div className="text-xs uppercase tracking-wider text-amber-800 mb-1 font-medium">
            {t("signal.label")}
          </div>
          <div className="text-sm">
            <strong>{company.signalType}</strong>
            {company.signalSource && (
              <span className="text-muted-foreground"> · {t("signal.source")} {company.signalSource}</span>
            )}
            {company.signalDetectedAt && (
              <span className="text-muted-foreground">
                {" · "}
                {formatDateInTz(company.signalDetectedAt, locale, { timeZone: userTimezone, dateStyle: "medium" })}
              </span>
            )}
          </div>
          {company.notes && (
            <div className="text-sm text-muted-foreground mt-2">{company.notes}</div>
          )}
        </div>
      )}

      {/* Tabs */}
      <CompanyTabs
        companyId={company.id}
        active={tab}
        counts={{
          sites: company.sites.length,
          contacts: company.contacts.length,
          interactions: interactionsCount,
          tasks: tasksCount,
        }}
        labels={{
          overview: t("tabs.overview"),
          sites: t("tabs.sites"),
          contacts: t("tabs.contacts"),
          interactions: t("tabs.interactions"),
          tasks: t("tabs.tasks"),
          opportunities: t("tabs.opportunities"),
          files: t("tabs.files"),
          soon: t("tabs.soon"),
        }}
      />

      {tab === "sites" && (
        <SitesSection companyId={company.id} sites={company.sites} />
      )}

      {tab === "contacts" && (
        <ContactsTabPanel companyId={company.id} contacts={company.contacts} />
      )}

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-6 min-w-0">
            {/* Group card — only when there's actually a group */}
            {hasGroup && groupStats && (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-serif text-lg font-bold flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-brand-teal" />
                    {t("group.title")}
                  </h2>
                  {hasParent && (
                    <Link
                      href={`/companies/${groupRoot.id}`}
                      className="text-sm text-brand-teal hover:underline"
                    >
                      {t("group.viewRoot")} →
                    </Link>
                  )}
                </div>
                <div className="text-sm mb-4">
                  {hasParent ? (
                    <>
                      <span className="text-muted-foreground">{t("group.parentLabel")} </span>
                      <Link
                        href={`/companies/${company.parent!.id}`}
                        className="font-medium hover:text-brand-teal"
                      >
                        {company.parent!.name}
                      </Link>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider bg-brand-teal/15 text-brand-teal mr-2">
                        {t("group.rootBadge")}
                      </span>
                      <span className="text-muted-foreground">
                        {t("group.rootSubtitle", { count: company.children.length })}
                      </span>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                  <GroupStat value={groupStats.groupSize} label={t("group.stats.companies")} />
                  <GroupStat value={groupStats.sites} label={t("group.stats.sites")} />
                  <GroupStat value={groupStats.activeProspects} label={t("group.stats.activeProspects")} />
                </div>
                {(hasChildren || hasParent) && (
                  <div className="text-xs text-muted-foreground">
                    {hasChildren && (
                      <>
                        {t("group.otherMembers")}:{" "}
                        {company.children.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ", "}
                            <Link href={`/companies/${c.id}`} className="hover:text-brand-teal hover:underline">
                              {c.name}
                            </Link>
                          </span>
                        ))}
                      </>
                    )}
                    {hasParent && !hasChildren && t("group.viewRootForSiblings")}
                  </div>
                )}
              </Card>
            )}

            {/* Informations entreprise */}
            <Card className="p-6">
              <h2 className="font-serif text-lg font-bold mb-4">{t("info.title")}</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <InfoRow
                  label={t("info.address")}
                  value={
                    primarySite
                      ? [primarySite.addressLine1, primarySite.postalCode, primarySite.city]
                          .filter(Boolean)
                          .join(", ") || t("info.noPrimarySite")
                      : t("info.noPrimarySite")
                  }
                />
                <InfoRow
                  label={t("info.standing")}
                  value={company.standing ? "★".repeat(company.standing) : null}
                />
                <InfoRow label={t("info.size")} value={company.sizeEstimate} />
                <InfoRow label={t("info.legalName")} value={company.legalName} />
                <InfoRow label={t("info.primaryLocale")} value={company.primaryLocale.toUpperCase()} />
                {(() => {
                  // Same cascade the sequence engine uses (company → org), so
                  // the UI tells the truth about what automation will pick.
                  const tz = resolveCompanyTimezone({
                    companyTz: company.timezone,
                    orgTz: activeOrganization.timezone,
                  });
                  const suffix =
                    tz.source === "company"
                      ? null
                      : ` · ${t(`info.timezoneInheritedFrom.${tz.source}`)}`;
                  return (
                    <InfoRow
                      label={t("info.timezone")}
                      value={suffix ? `${tz.tz}${suffix}` : tz.tz}
                    />
                  );
                })()}
                <InfoRow
                  label={t("info.addedAt")}
                  value={formatDateInTz(company.createdAt, locale, { timeZone: userTimezone, dateStyle: "medium" })}
                />
                <InfoRow
                  label={t("info.relationship")}
                  value={
                    company.relationshipType
                      ? tRelationship(company.relationshipType as Parameters<typeof tRelationship>[0])
                      : null
                  }
                />
                <InfoRow label={t("info.industry")} value={company.industry} />
                <InfoRow label={t("info.owner")} value={ownerName} />
              </dl>
            </Card>

            {/* Contact prioritaire */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-lg font-bold">{t("priorityContact.title")}</h2>
                <div className="flex items-center gap-2">
                  {primaryContact && (
                    <Link
                      href={`/contacts/${primaryContact.id}`}
                      className="text-sm text-brand-teal hover:underline"
                    >
                      {t("priorityContact.viewContact")} →
                    </Link>
                  )}
                  {company.contacts.length > 0 && (
                    <PrimaryContactDialog
                      companyId={company.id}
                      currentPrimaryId={company.primaryContactId ?? null}
                      contacts={company.contacts.map((c) => ({
                        id: c.id,
                        kind: c.kind,
                        firstName: c.firstName,
                        lastName: c.lastName,
                        jobTitle: c.jobTitle,
                        email: c.email,
                      }))}
                      action={setPrimaryContactAction}
                      triggerLabel={
                        primaryContact ? t("priorityContact.change") : t("priorityContact.define")
                      }
                      dialogTitle={t("priorityContact.dialogTitle")}
                      dialogDescription={t("priorityContact.dialogDescription")}
                      saveLabel={t("priorityContact.save")}
                      cancelLabel={t("priorityContact.cancel")}
                      noneLabel={t("priorityContact.none")}
                      selectLabel={t("priorityContact.selectLabel")}
                    />
                  )}
                </div>
              </div>
              {primaryContact ? (
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-brand-amber/90 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                    {initialsFromName(resolveContactDisplayName(primaryContact))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      {resolveContactDisplayName(primaryContact)}
                    </div>
                    <div className="text-sm text-muted-foreground">{primaryContact.jobTitle ?? "—"}</div>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {primaryContact.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {primaryContact.email}
                        </span>
                      )}
                      {primaryContact.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {primaryContact.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {company.contacts.length > 0
                    ? t("priorityContact.empty")
                    : t("priorityContact.emptyNoContacts")}
                </p>
              )}
            </Card>

            {/* Score breakdown */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-lg font-bold">{t("scoreBreakdown.title")}</h2>
                <div className="flex items-center gap-2">
                  {company.score != null && grade && (
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                        scoreBadgeClasses(company.score),
                      )}
                    >
                      {company.score} / 100 · {grade}
                    </span>
                  )}
                  <form action={recomputeCompanyScoreAction}>
                    <input type="hidden" name="companyId" value={company.id} />
                    <SubmitButton size="sm" variant="outline" className="h-7 text-xs px-2">
                      {t("scoreBreakdown.recompute")}
                    </SubmitButton>
                  </form>
                </div>
              </div>
              {company.scoreBreakdown == null ? (
                <p className="text-sm text-muted-foreground">{t("scoreBreakdown.noScore")}</p>
              ) : (
                <ScoreBreakdownRows
                  breakdown={company.scoreBreakdown as ScoreBreakdown}
                  locale={locale}
                  userTimezone={userTimezone}
                  labels={{
                    standing:   t("scoreBreakdown.standing"),
                    signal:     t("scoreBreakdown.signal"),
                    engagement: t("scoreBreakdown.engagement"),
                    tasks:      t("scoreBreakdown.tasks"),
                    contact:    t("scoreBreakdown.contact"),
                    computedAt: t("scoreBreakdown.computedAt"),
                  }}
                />
              )}
            </Card>

            {/* Notes terrain */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-serif text-lg font-bold">{t("fieldNotes.title")}</h2>
                <Button size="sm" variant="outline" disabled title={t("fieldNotes.soon")}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {t("fieldNotes.add")}
                </Button>
              </div>
              {company.notes ? (
                <p className="text-sm whitespace-pre-wrap text-foreground">{company.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("fieldNotes.empty")}</p>
              )}
            </Card>
          </div>

          {/* Right sidebar */}
          <div className="space-y-6">
            <CompanyTasksCard
              companyId={company.id}
              orgId={activeOrganization.id}
              userTimezone={userTimezone}
              limit={5}
            />
            <CompanyInteractionsCard
              companyId={company.id}
              companyName={company.name}
              orgId={activeOrganization.id}
              userTimezone={userTimezone}
              limit={5}
            />
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <CompanyTasksCard
          companyId={company.id}
          orgId={activeOrganization.id}
          userTimezone={userTimezone}
        />
      )}

      {tab === "interactions" && (
        <CompanyInteractionsCard
          companyId={company.id}
          companyName={company.name}
          orgId={activeOrganization.id}
          userTimezone={userTimezone}
        />
      )}
    </div>
  );
}

async function CompanyTasksCard({
  companyId,
  orgId,
  userTimezone,
  limit,
}: {
  companyId: string;
  orgId: string;
  userTimezone: string;
  /** Cap on rendered rows. Omitted = no cap (used on the dedicated tab). */
  limit?: number;
}) {
  const companyTasks = await getTasksByCompany(orgId, companyId);
  const locale = await getLocale();
  const tTaskType = await getTranslations("taskType");
  const tTasks = await getTranslations("pages.tasks");
  const visibleTasks = limit ? companyTasks.slice(0, limit) : companyTasks;
  return (
    <Card className="p-5 bg-brand-amber/5 border-brand-amber/30">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-amber-800 font-medium">
          {tTasks("breadcrumb")} {limit && companyTasks.length > 0 && `(${companyTasks.length})`}
        </div>
        <Link
          href={`/tasks/new?companyId=${companyId}`}
          className="text-xs text-brand-teal hover:underline"
        >
          + {tTasks("newTask")}
        </Link>
      </div>
      {companyTasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tTasks("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visibleTasks.map((task) => (
            <li key={task.id} className="text-sm">
              <Link href={`/tasks/${task.id}`} className="hover:underline">
                <span className="font-medium">
                  {tTaskType(task.type as Parameters<typeof tTaskType>[0])}
                </span>
                {" · "}
                <span className="text-foreground">{task.title}</span>
              </Link>
              {task.dueAt && (
                <span className="text-xs text-muted-foreground ml-1">
                  · {formatDateInTz(task.dueAt, locale, { timeZone: userTimezone, dateStyle: "short" })}
                </span>
              )}
              {task.contact && (
                <div className="text-xs text-muted-foreground">
                  {resolveContactDisplayName(task.contact)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function CompanyInteractionsCard({
  companyId,
  companyName,
  orgId,
  userTimezone,
  limit,
}: {
  companyId: string;
  companyName: string;
  orgId: string;
  userTimezone: string;
  /** Cap on rendered rows. Omitted = no cap (used on the dedicated tab). */
  limit?: number;
}) {
  const companyInteractions = await getInteractionsByCompany(orgId, companyId);
  const visibleInteractions = limit
    ? companyInteractions.slice(0, limit)
    : companyInteractions;
  const locale = await getLocale();
  const t = await getTranslations("pages.companies");
  const tI = await getTranslations("pages.interactions");
  const tInteractionType = await getTranslations("interactionType");
  const tInteractionChannel = await getTranslations("interactionChannel");
  const tInteractionOutcome = await getTranslations("interactionOutcome");

  const INTERACTION_TYPES = ["first_contact", "follow_up", "call", "visit", "linkedin", "meeting", "demo", "proposal_sent", "note"] as const;
  const CHANNELS = ["email", "linkedin", "phone", "in_person", "video", "other"] as const;
  const OUTCOMES = ["no_response", "positive_reply", "negative_reply", "out_of_office", "wrong_contact", "rdv_scheduled", "opted_out"] as const;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif text-lg font-bold">{t("recentActivity.title")}</h2>
        <LogInteractionForm
          companyId={companyId}
          companyName={companyName}
          action={logInteractionAction}
          labels={{
            logNew: tI("logNew"),
            fields: {
              type: tI("fields.type"),
              channel: tI("fields.channel"),
              outcome: tI("fields.outcome"),
              summary: tI("fields.summary"),
              occurredAt: tI("fields.occurredAt"),
              interestLevel: tI("fields.interestLevel"),
            },
            submit: tI("submit"),
            cancel: tI("cancel"),
          }}
          interactionTypes={INTERACTION_TYPES.map((v) => ({ value: v, label: tInteractionType(v) }))}
          channels={CHANNELS.map((v) => ({ value: v, label: tInteractionChannel(v) }))}
          outcomes={OUTCOMES.map((v) => ({ value: v, label: tInteractionOutcome(v) }))}
        />
      </div>
      {companyInteractions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tI("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {visibleInteractions.map((interaction) => (
            <li key={interaction.id} className="text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-xs">
                    {tInteractionType(interaction.type as Parameters<typeof tInteractionType>[0])}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {" · "}{tInteractionChannel(interaction.channel as Parameters<typeof tInteractionChannel>[0])}
                  </span>
                  {interaction.contact && (
                    <div className="text-xs text-muted-foreground">
                      {resolveContactDisplayName(interaction.contact)}
                    </div>
                  )}
                  {interaction.summary && (
                    <p className="text-xs text-foreground mt-0.5 line-clamp-2">{interaction.summary}</p>
                  )}
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {formatDateInTz(interaction.occurredAt, locale, { timeZone: userTimezone, dateStyle: "short" })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-foreground mt-0.5">{value ?? "—"}</dd>
    </div>
  );
}

function GroupStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center p-3 rounded-md bg-secondary/40">
      <div className="font-serif text-2xl font-bold">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

async function ContactsTabPanel({
  companyId,
  contacts,
}: {
  companyId: string;
  contacts: {
    id: string;
    kind: "person" | "generic";
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    role: string | null;
    email: string | null;
    relevance: number | null;
  }[];
}) {
  const tContacts = await getTranslations("pages.contacts");
  return (
    <section>
      <PageHeader
        title={tContacts("titleSection")}
        right={
          <Link href={`/contacts/new?companyId=${companyId}`}>
            <Button size="sm" variant="outline">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {tContacts("new")}
            </Button>
          </Link>
        }
      />
      <Card className="p-0 overflow-hidden">
        {contacts.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tContacts("emptyForCompany")}
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground text-[11px] uppercase tracking-wider text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{tContacts("columns.name")}</th>
                <th className="px-4 py-3 font-medium">{tContacts("columns.role")}</th>
                <th className="px-4 py-3 font-medium">{tContacts("columns.email")}</th>
                <th className="px-4 py-3 font-medium">{tContacts("columns.relevance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c) => (
                <tr key={c.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:text-brand-teal">
                      {resolveContactDisplayName(c)}
                    </Link>
                    {c.jobTitle && <div className="text-xs text-muted-foreground">{c.jobTitle}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.role ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground break-all">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.relevance ? "★".repeat(c.relevance) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </section>
  );
}

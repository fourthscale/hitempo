import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload, ChevronDown, Building2 } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { listCompaniesByOrgEnriched } from "@/db/queries/companies";
import { scoreGrade, scoreBadgeClasses } from "@/lib/scoring/grade";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// PLACEHOLDER: filter chips are visual only until the segments + micro_zones
// tables ship in a later sprint. They render as disabled buttons with future
// counts wired to 0.
const FILTERS = [
  { key: "segment", label: "Segment", count: 0 },
  { key: "microZone", label: "Micro-zone", count: 0 },
  { key: "score", label: "Score", count: 0 },
  { key: "signal", label: "Signal", count: 0 },
  { key: "status", label: "Statut", count: 0 },
] as const;

export default async function CompaniesPage() {
  const { activeOrganization } = await getActiveOrg();
  const rows = await listCompaniesByOrgEnriched(activeOrganization.id);
  const t = await getTranslations("pages.companies");
  const tNav = await getTranslations("nav");
  const tStatus = await getTranslations("companyStatus");
  // eslint-disable-next-line react-hooks/purity -- server component, renders once per request
  const now = Date.now();

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title={tNav("companies")}
        subtitle={t("count", { count: rows.length })}
        right={
          <div className="flex items-center gap-2">
            <Link href="/settings/import">
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-1.5" />
                {t("importCsv")}
              </Button>
            </Link>
            <Link href="/companies/new">
              <Button>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("new")}
              </Button>
            </Link>
          </div>
        }
      />

      {/* Filter chips — UI placeholder, no logic yet */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
            title={t("filtersSoon")}
          >
            {f.label}
            {f.count > 0 && <span className="text-foreground/80 font-medium">{f.count}</span>}
            <ChevronDown className="h-3 w-3" />
          </button>
        ))}
        <button
          type="button"
          disabled
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60 disabled:cursor-not-allowed"
          title={t("filtersSoon")}
        >
          {t("moreFilters")}
        </button>
      </div>

      <Card className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t("empty")}
            action={{ label: t("emptyAction"), href: "/companies/new" }}
          />
        ) : (
          <>
          {/* Mobile / tablet portrait : cards layout (one per row) */}
          <ul className="lg:hidden divide-y divide-border">
            {rows.map((c) => {
              const grade = scoreGrade(c.score);
              const addressBits = c.primarySite
                ? [c.primarySite.addressLine1, c.primarySite.postalCode, c.primarySite.city]
                    .filter(Boolean)
                    .join(", ")
                : null;
              const daysSince = c.signalDetectedAt
                ? Math.floor(
                    (now - new Date(c.signalDetectedAt).getTime()) /
                      (1000 * 60 * 60 * 24),
                  )
                : null;
              const isFresh = daysSince != null && daysSince <= 30;
              return (
                <li key={c.id}>
                  <Link
                    href={`/companies/${c.id}`}
                    className="block px-4 py-3 hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">{c.name}</div>
                        {addressBits && (
                          <div className="text-xs text-muted-foreground mt-0.5">{addressBits}</div>
                        )}
                      </div>
                      {c.score != null && grade && (
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium shrink-0",
                            scoreBadgeClasses(c.score),
                          )}
                        >
                          {c.score} · {grade}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                        {tStatus(c.status as Parameters<typeof tStatus>[0])}
                      </span>
                      {c.signalType && (
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded font-medium",
                            isFresh
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600",
                          )}
                        >
                          {c.signalType}
                          {daysSince != null && ` · ${daysSince}d`}
                        </span>
                      )}
                      {c.topContact && (
                        <span className="text-muted-foreground">
                          · {resolveContactDisplayName(c.topContact)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop : table layout */}
          <div className="hidden lg:block overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground text-[11px] uppercase tracking-wider">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">{t("columns.company")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.segment")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.microZone")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.score")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.signal")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.contactPrio")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.status")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.nextAction")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => {
                const grade = scoreGrade(c.score);
                const addressBits = c.primarySite
                  ? [c.primarySite.addressLine1, c.primarySite.postalCode, c.primarySite.city]
                      .filter(Boolean)
                      .join(", ")
                  : null;

                return (
                  <tr key={c.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3 align-top">
                      <Link href={`/companies/${c.id}`} className="font-medium hover:text-brand-teal">
                        {c.name}
                      </Link>
                      {addressBits && (
                        <div className="text-xs text-muted-foreground mt-0.5">{addressBits}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {/* PLACEHOLDER: segment label requires the segments table (sprint TBD) */}
                      —
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {/* PLACEHOLDER: micro_zones table (sprint TBD) */}
                      —
                    </td>
                    <td className="px-4 py-3 align-top">
                      {c.score != null && grade ? (
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                            scoreBadgeClasses(c.score),
                          )}
                        >
                          {c.score} · {grade}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {c.signalType ? (() => {
                        const daysSince = c.signalDetectedAt
                          ? Math.floor(
                              (Date.now() - new Date(c.signalDetectedAt).getTime()) /
                                (1000 * 60 * 60 * 24),
                            )
                          : null;
                        const isFresh = daysSince != null && daysSince <= 30;
                        return (
                          <div>
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium",
                                isFresh
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600",
                              )}
                            >
                              {c.signalType}
                            </span>
                            {daysSince != null && (
                              <div
                                className={cn(
                                  "text-[10px] mt-0.5",
                                  isFresh ? "text-amber-600" : "text-muted-foreground",
                                )}
                              >
                                {daysSince}d
                              </div>
                            )}
                          </div>
                        );
                      })() : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {c.topContact ? (
                        <>
                          <div className="text-foreground">
                            {resolveContactDisplayName(c.topContact)}
                          </div>
                          {c.topContact.jobTitle && (
                            <div className="text-xs text-muted-foreground">{c.topContact.jobTitle}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {tStatus(c.status as Parameters<typeof tStatus>[0])}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {/* PLACEHOLDER: requires tasks table (sprint 05) */}
                      —
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          </>
        )}
      </Card>

      {/* Pagination placeholder — wired to real cursor pagination later */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
          <span>{t("paginationShowing", { shown: rows.length, total: rows.length })}</span>
          <span>‹ 1 / 1 ›</span>
        </div>
      )}
    </div>
  );
}

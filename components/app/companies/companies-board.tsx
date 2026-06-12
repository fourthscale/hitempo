"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { scoreGrade, scoreBadgeClasses } from "@/lib/scoring/grade";
import { chipSelectClass } from "@/components/app/filter-chip-class";

export type CompanyBoardRow = {
  id: string;
  name: string;
  status: string;
  score: number | null;
  industry: string | null;
  signalType: string | null;
  signalDetectedAt: Date | string | null;
  ownerId: string | null;
  primarySite: {
    city: string | null;
    postalCode: string | null;
    addressLine1: string | null;
  } | null;
  topContact: {
    id: string;
    kind: "person" | "generic";
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    email: string | null;
  } | null;
};

const COMPANY_STATUSES = [
  "to_qualify",
  "to_contact",
  "to_follow_up",
  "qualified",
  "not_interested",
] as const;

/**
 * Filter chips + responsive list/table rendering for /companies. URL-driven
 * (owner / industry / signal / status), matching the contacts board idiom.
 *
 * The owner filter's UX is intentionally inverted vs the others : the empty
 * URL state means "default to me" so the rep lands on her own portfolio.
 * Picking another owner sets the param ; picking herself drops it.
 */
export function CompaniesBoard({
  rows,
  members,
  industries,
  signals,
  currentUserId,
  selectedOwnerId,
  selectedIndustry,
  selectedSignal,
  selectedStatus,
}: {
  rows: CompanyBoardRow[];
  members: { userId: string; displayName: string }[];
  industries: string[];
  signals: string[];
  currentUserId: string;
  selectedOwnerId: string | null;
  selectedIndustry: string | null;
  selectedSignal: string | null;
  selectedStatus: string | null;
}) {
  const t = useTranslations("pages.companies");
  const tStatus = useTranslations("companyStatus");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // eslint-disable-next-line react-hooks/purity -- client component, recomputed each render
  const now = Date.now();

  const memberById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members) m.set(x.userId, x.displayName);
    return m;
  }, [members]);
  const currentMemberName = useMemo(
    () => members.find((m) => m.userId === currentUserId)?.displayName ?? null,
    [members, currentUserId],
  );

  // Owner select : `null` (default = me) materializes as currentUserId
  // for the dropdown ; an explicit "all" is the "no owner filter" choice.
  const ownerSelectValue =
    selectedOwnerId == null ? "all" : selectedOwnerId;

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  }

  function updateOwner(value: string) {
    // Picking the current user means "go back to default" — drop the
    // param entirely rather than carry a redundant value in the URL.
    const next = new URLSearchParams(search.toString());
    if (value === "" || value === currentUserId) {
      next.delete("owner");
    } else {
      next.set("owner", value);
    }
    router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  }

  return (
    <>
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <select
          name="owner"
          value={ownerSelectValue}
          onChange={(e) => updateOwner(e.target.value)}
          aria-label={t("filters.owner")}
          className={chipSelectClass(selectedOwnerId != null)}
        >
          <option value="all">{t("filters.ownerAll")}</option>
          {currentMemberName && (
            <option value={currentUserId}>
              {t("filters.ownerMeOption", { name: currentMemberName })}
            </option>
          )}
          {members
            .filter((m) => m.userId !== currentUserId)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          <option value="unassigned">{t("filters.ownerUnassigned")}</option>
        </select>

        <select
          name="industry"
          value={selectedIndustry ?? ""}
          onChange={(e) => updateParam("industry", e.target.value)}
          aria-label={t("filters.industry")}
          className={chipSelectClass(selectedIndustry != null)}
        >
          <option value="">{t("filters.industry")}</option>
          {industries.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
          <option value="unassigned">{t("filters.industryUnassigned")}</option>
        </select>

        <select
          name="signal"
          value={selectedSignal ?? ""}
          onChange={(e) => updateParam("signal", e.target.value)}
          aria-label={t("filters.signal")}
          className={chipSelectClass(selectedSignal != null)}
        >
          <option value="">{t("filters.signal")}</option>
          {signals.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
          <option value="none">{t("filters.signalNone")}</option>
        </select>

        <select
          name="status"
          value={selectedStatus ?? ""}
          onChange={(e) => updateParam("status", e.target.value)}
          aria-label={t("filters.status")}
          className={chipSelectClass(selectedStatus != null)}
        >
          <option value="">{t("filters.status")}</option>
          {COMPANY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s as Parameters<typeof tStatus>[0])}
            </option>
          ))}
        </select>
      </div>

      {/* Wrap the list itself in its own Card — matches the /contacts layout
          where filters live OUTSIDE the card (above) and the Card hosts only
          the list. Keep this in sync across listing pages. */}
      <Card className="p-0 overflow-hidden">
      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t("noResultsForFilters")}
        </div>
      ) : (
        <>
          {/* Mobile / tablet portrait : cards layout */}
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
                      {c.industry && (
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                          {c.industry}
                        </span>
                      )}
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
                      {c.ownerId && (
                        <span className="text-muted-foreground">
                          · {memberById.get(c.ownerId) ?? t("filters.ownerUnknown")}
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
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-muted-foreground text-[11px] uppercase tracking-wider">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">{t("columns.company")}</th>
                  <th className="px-4 py-3 font-medium">{t("columns.industry")}</th>
                  <th className="px-4 py-3 font-medium">{t("columns.owner")}</th>
                  <th className="px-4 py-3 font-medium">{t("columns.score")}</th>
                  <th className="px-4 py-3 font-medium">{t("columns.signal")}</th>
                  <th className="px-4 py-3 font-medium">{t("columns.contactPrio")}</th>
                  <th className="px-4 py-3 font-medium">{t("columns.status")}</th>
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
                        {c.industry ?? "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {c.ownerId
                          ? (memberById.get(c.ownerId) ?? t("filters.ownerUnknown"))
                          : "—"}
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
                                (now - new Date(c.signalDetectedAt).getTime()) /
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      </Card>
    </>
  );
}


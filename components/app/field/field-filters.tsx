"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { chipSelectClass } from "@/components/app/filter-chip-class";

/**
 * URL-driven filter chips for the /field map. Same idiom as
 * /contacts and /companies : each select navigates on change, the
 * server re-renders with the new pin set, no submit button needed.
 *
 * Kept as a client component because the chips need access to
 * `router.push` to navigate on every change ; the parent page stays a
 * server component and reads the URL params it generates.
 */
export function FieldFilters({
  members,
  industries,
  signals,
  statusOptions,
  currentUserId,
  selectedOwnerId,
  selectedIndustry,
  selectedSignal,
  selectedStatus,
  selectedCompanyId,
}: {
  members: { userId: string; displayName: string }[];
  industries: string[];
  signals: string[];
  statusOptions: { value: string; label: string }[];
  currentUserId: string;
  selectedOwnerId: string | null;
  selectedIndustry: string | null;
  selectedSignal: string | null;
  selectedStatus: string | null;
  selectedCompanyId: string | null;
}) {
  const t = useTranslations("pages.field");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const currentMemberName = useMemo(
    () => members.find((m) => m.userId === currentUserId)?.displayName ?? null,
    [members, currentUserId],
  );

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  }

  function updateOwner(value: string) {
    const next = new URLSearchParams(search.toString());
    // Picking the current user means "back to default" — drop the
    // param entirely rather than carry a redundant value in the URL.
    if (value === "" || value === currentUserId) {
      next.delete("owner");
    } else {
      next.set("owner", value);
    }
    router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  }

  const ownerSelectValue = selectedOwnerId == null ? "all" : selectedOwnerId;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
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
      </select>

      <select
        name="status"
        value={selectedStatus ?? ""}
        onChange={(e) => updateParam("status", e.target.value)}
        aria-label={t("filters.status")}
        className={chipSelectClass(selectedStatus != null)}
      >
        <option value="">{t("filters.status")}</option>
        {statusOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {selectedCompanyId && (
        // companyId filter is set by deep-linking from another page,
        // not the chip bar. Surface it as a removable pill so the user
        // sees the scope is narrowed and can clear it in one click.
        <Link
          href={buildClearCompanyHref(search.toString())}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-brand-teal text-foreground bg-brand-teal/5 text-xs font-medium"
        >
          {t("filters.companyScoped")}
          <span aria-hidden>×</span>
        </Link>
      )}
    </div>
  );
}

function buildClearCompanyHref(currentSearch: string): string {
  const next = new URLSearchParams(currentSearch);
  next.delete("companyId");
  const qs = next.toString();
  return qs ? `/field?${qs}` : "/field";
}

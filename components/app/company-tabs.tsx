import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tab strip for the company detail page.
 *
 * Tabs that route within /companies/[id] use the `?tab=` query param ;
 * disabled tabs are placeholders for features that ship later (V1).
 *
 * Labels come from the parent server component via the `labels` prop so
 * they stay i18n-driven (no hardcoded strings here).
 */
export function CompanyTabs({
  companyId,
  active,
  counts,
  labels,
}: {
  companyId: string;
  active: "overview" | "sites" | "contacts" | "interactions" | "tasks" | "opportunities" | "files";
  counts: { sites: number; contacts: number; interactions: number; tasks: number };
  labels: {
    overview: string;
    sites: string;
    contacts: string;
    interactions: string;
    tasks: string;
    opportunities: string;
    files: string;
    /** Tooltip on disabled tabs. */
    soon: string;
  };
}) {
  const tabs = [
    { key: "overview", label: labels.overview, count: null, href: `/companies/${companyId}`, enabled: true },
    { key: "sites", label: labels.sites, count: counts.sites, href: `/companies/${companyId}?tab=sites`, enabled: true },
    { key: "contacts", label: labels.contacts, count: counts.contacts, href: `/companies/${companyId}?tab=contacts`, enabled: true },
    { key: "interactions", label: labels.interactions, count: counts.interactions, href: `/companies/${companyId}?tab=interactions`, enabled: true },
    { key: "tasks", label: labels.tasks, count: counts.tasks, href: `/companies/${companyId}?tab=tasks`, enabled: true },
    { key: "opportunities", label: labels.opportunities, count: null, href: null, enabled: false },
    { key: "files", label: labels.files, count: null, href: null, enabled: false },
  ] as const;

  return (
    <div className="border-b border-border mb-6">
      <nav className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const isActive = active === t.key;
          const baseCls = cn(
            "inline-flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap",
            isActive
              ? "border-brand-teal text-foreground font-medium"
              : "border-transparent text-muted-foreground",
            t.enabled && !isActive && "hover:text-foreground hover:border-border cursor-pointer",
            !t.enabled && "opacity-50 cursor-not-allowed",
          );
          const content = (
            <>
              {t.label}
              {t.count != null && (
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    isActive ? "bg-brand-teal/15 text-brand-teal" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              )}
            </>
          );

          if (t.enabled && t.href) {
            return (
              <Link key={t.key} href={t.href} className={baseCls}>
                {content}
              </Link>
            );
          }
          return (
            <button
              key={t.key}
              type="button"
              disabled={!t.enabled}
              title={!t.enabled ? labels.soon : undefined}
              className={baseCls}
            >
              {content}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

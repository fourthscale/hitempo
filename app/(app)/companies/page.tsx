import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload, Building2 } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import {
  listCompaniesByOrgEnriched,
  listCompanyIndustriesByOrg,
  listCompanySignalsByOrg,
  countCompaniesByOrg,
  UNASSIGNED_COMPANY_OWNER,
} from "@/db/queries/companies";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompaniesBoard } from "@/components/app/companies/companies-board";

const COMPANY_STATUSES = new Set([
  "to_qualify",
  "to_contact",
  "to_follow_up",
  "qualified",
  "not_interested",
]);

function clampUuid(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{
    owner?: string;
    industry?: string;
    signal?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;

  // Members list is needed both for the dropdown AND to decide what
  // "default" means : only members get "default = me", platform admins
  // browsing an org they don't belong to fall back to "all" (otherwise
  // the page lands on an empty list with no obvious way out).
  const members = await getOrgMembersWithNames(orgId);
  const isMember = members.some((m) => m.userId === user.id);

  // Owner default = me when the logged-in user belongs to the org,
  // otherwise "all" (no filter) ; same idiom as /contacts.
  const rawOwner = params.owner;
  const defaultOwnerId = isMember ? user.id : null;
  const selectedOwnerId: string | null =
    rawOwner === "all"
      ? null
      : rawOwner === UNASSIGNED_COMPANY_OWNER
        ? UNASSIGNED_COMPANY_OWNER
        : (clampUuid(rawOwner) ?? defaultOwnerId);

  // Industry / signal / status : passthrough with light validation
  // (empty / unknown values are dropped). `industry` and `signal` accept
  // a wide range of free-text values so we don't restrict them to a
  // known set ; the query treats an unknown value as "no match" which
  // is the correct UX (the filter chip stays visible, the list is empty).
  const selectedIndustry = params.industry ? params.industry : null;
  const selectedSignal = params.signal ? params.signal : null;
  const selectedStatus =
    params.status && COMPANY_STATUSES.has(params.status) ? params.status : null;

  const [rows, industries, signals, totalInOrg] = await Promise.all([
    listCompaniesByOrgEnriched(orgId, {
      ownerId: selectedOwnerId ?? undefined,
      industry: selectedIndustry ?? undefined,
      signal: selectedSignal ?? undefined,
      status: selectedStatus ?? undefined,
    }),
    listCompanyIndustriesByOrg(orgId),
    listCompanySignalsByOrg(orgId),
    countCompaniesByOrg(orgId),
  ]);

  const t = await getTranslations("pages.companies");
  const tNav = await getTranslations("nav");

  // EmptyState only when the org genuinely has 0 companies — having
  // filters set but 0 results is a different message, handled inside
  // CompaniesBoard.
  const orgIsEmpty = totalInOrg === 0;

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

      {orgIsEmpty ? (
        <Card className="p-0 overflow-hidden">
          <EmptyState
            icon={Building2}
            title={t("empty")}
            action={{ label: t("emptyAction"), href: "/companies/new" }}
          />
        </Card>
      ) : (
        // Filters live outside the Card (above), same layout as /contacts —
        // the board renders its own Card around the list.
        <CompaniesBoard
          rows={rows.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            score: c.score,
            industry: c.industry,
            signalType: c.signalType,
            signalDetectedAt: c.signalDetectedAt,
            ownerId: c.ownerId,
            primarySite: c.primarySite,
            topContact: c.topContact,
          }))}
          members={members.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
          }))}
          industries={industries}
          signals={signals}
          currentUserId={user.id}
          selectedOwnerId={selectedOwnerId}
          selectedIndustry={selectedIndustry}
          selectedSignal={selectedSignal}
          selectedStatus={selectedStatus}
        />
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
          <span>{t("paginationShowing", { shown: rows.length, total: rows.length })}</span>
          <span>‹ 1 / 1 ›</span>
        </div>
      )}
    </div>
  );
}

import "leaflet/dist/leaflet.css";

import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/auth/context";
import {
  listSitesForFieldMap,
  countSitesWithoutGeo,
  UNASSIGNED_FIELD_OWNER,
} from "@/db/queries/field-sites";
import {
  listCompanyIndustriesByOrg,
  listCompanySignalsByOrg,
} from "@/db/queries/companies";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { PageHeader } from "@/components/app/page-header";
import { FieldMap } from "@/components/app/field/field-map";
import { FieldFilters } from "@/components/app/field/field-filters";
import { BackfillGeocodesButton } from "@/components/app/field/backfill-geocodes-button";

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

export default async function FieldPage({
  searchParams,
}: {
  searchParams: Promise<{
    owner?: string;
    industry?: string;
    signal?: string;
    status?: string;
    companyId?: string;
  }>;
}) {
  const params = await searchParams;
  const { activeOrganization, user } = await getActiveOrg();
  const orgId = activeOrganization.id;

  // Same default-to-me idiom as /contacts and /companies. Platform
  // admins (non-members) fall back to "all".
  const members = await getOrgMembersWithNames(orgId);
  const isMember = members.some((m) => m.userId === user.id);
  const rawOwner = params.owner;
  const defaultOwnerId = isMember ? user.id : null;
  const selectedOwnerId: string | null =
    rawOwner === "all"
      ? null
      : rawOwner === UNASSIGNED_FIELD_OWNER
        ? UNASSIGNED_FIELD_OWNER
        : (clampUuid(rawOwner) ?? defaultOwnerId);

  const selectedIndustry = params.industry ? params.industry : null;
  const selectedSignal = params.signal ? params.signal : null;
  const selectedStatus =
    params.status && COMPANY_STATUSES.has(params.status) ? params.status : null;
  const selectedCompanyId = clampUuid(params.companyId);

  const [pins, industries, signals, sitesWithoutGeo] = await Promise.all([
    listSitesForFieldMap(orgId, {
      ownerId: selectedOwnerId ?? undefined,
      industry: selectedIndustry ?? undefined,
      signal: selectedSignal ?? undefined,
      status: selectedStatus ?? undefined,
      companyId: selectedCompanyId ?? undefined,
    }),
    listCompanyIndustriesByOrg(orgId),
    listCompanySignalsByOrg(orgId),
    countSitesWithoutGeo(orgId),
  ]);

  const t = await getTranslations("pages.field");
  const tNav = await getTranslations("nav");
  const tStatus = await getTranslations("companyStatus");

  const statusOptions = Array.from(COMPANY_STATUSES).map((s) => ({
    value: s,
    label: tStatus(s as Parameters<typeof tStatus>[0]),
  }));

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title={tNav("field")}
        subtitle={t("pinCount", { count: pins.length })}
      />

      <FieldFilters
        members={members.map((m) => ({ userId: m.userId, displayName: m.displayName }))}
        industries={industries}
        signals={signals}
        statusOptions={statusOptions}
        currentUserId={user.id}
        selectedOwnerId={selectedOwnerId}
        selectedIndustry={selectedIndustry}
        selectedSignal={selectedSignal}
        selectedStatus={selectedStatus}
        selectedCompanyId={selectedCompanyId}
      />

      {sitesWithoutGeo > 0 && (
        // Above the map so the user sees it without scrolling — the
        // backfill is the unblocker for an empty map, surface it.
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            {t("missingGeoHint", { count: sitesWithoutGeo })}
          </p>
          <BackfillGeocodesButton pendingCount={sitesWithoutGeo} />
        </div>
      )}

      <FieldMap pins={pins} />
    </div>
  );
}

import "server-only";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, sites } from "@/db/schema";

/**
 * Sentinel value for the `ownerId` filter meaning "no effective owner".
 * Mirrors the contacts/companies pattern so the field map filters with
 * the same idiom across pages.
 */
export const UNASSIGNED_FIELD_OWNER = "unassigned" as const;

export type FieldMapSite = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  company: {
    id: string;
    name: string;
    status: string;
    industry: string | null;
    signalType: string | null;
    signalDetectedAt: Date | null;
    ownerId: string | null;
    score: number | null;
  };
};

/**
 * Sprint 14 — `/field` map. Returns all sites with non-NULL lat/lng
 * for the active org, joined with the parent company's filterable
 * attributes. Sites without coordinates are excluded (they can't be
 * placed on a map ; the caller surfaces a "X sites without geo" hint).
 *
 * Filter behaviour mirrors `listContactsByOrg` :
 *   - ownerId: filtered on COALESCE(NULL-for-now, company.owner_id) —
 *              sites don't have their own owner so the effective owner
 *              is the company's. UNASSIGNED_FIELD_OWNER matches a null
 *              owner.
 *   - industry / signal / status / companyId: straight equality on the
 *     company column. NULL handling is up to the caller.
 */
export async function listSitesForFieldMap(
  orgId: string,
  filters?: {
    ownerId?: string;
    industry?: string;
    signal?: string;
    status?: string;
    companyId?: string;
  },
): Promise<FieldMapSite[]> {
  // Effective owner here = the company's owner_id (sites don't carry
  // their own). Kept as a SQL expression so we can extend later if we
  // ever add `sites.owner_id`.
  const effectiveOwner = sql<string | null>`${companies.ownerId}`;

  const ownerFilter = !filters?.ownerId
    ? undefined
    : filters.ownerId === UNASSIGNED_FIELD_OWNER
      ? sql`${effectiveOwner} is null`
      : sql`${effectiveOwner} = ${filters.ownerId}`;

  const industryFilter = !filters?.industry
    ? undefined
    : eq(companies.industry, filters.industry);

  const signalFilter = !filters?.signal
    ? undefined
    : eq(companies.signalType, filters.signal);

  const statusFilter = !filters?.status
    ? undefined
    : eq(companies.status, filters.status);

  const companyFilter = !filters?.companyId
    ? undefined
    : eq(sites.companyId, filters.companyId);

  const rows = await getDb()
    .select({
      id: sites.id,
      name: sites.name,
      type: sites.type,
      lat: sites.lat,
      lng: sites.lng,
      addressLine1: sites.addressLine1,
      postalCode: sites.postalCode,
      city: sites.city,
      companyId: companies.id,
      companyName: companies.name,
      companyStatus: companies.status,
      companyIndustry: companies.industry,
      companySignalType: companies.signalType,
      companySignalDetectedAt: companies.signalDetectedAt,
      companyOwnerId: companies.ownerId,
      companyScore: companies.score,
    })
    .from(sites)
    .innerJoin(companies, eq(sites.companyId, companies.id))
    .where(
      and(
        eq(sites.organizationId, orgId),
        eq(companies.organizationId, orgId),
        isNull(companies.deletedAt),
        // Pins can only be drawn for sites we have coordinates for.
        isNotNull(sites.lat),
        isNotNull(sites.lng),
        ownerFilter,
        industryFilter,
        signalFilter,
        statusFilter,
        companyFilter,
      ),
    )
    .limit(2000);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    // pg returns numeric as string. Parse here so the client gets a
    // ready-to-use number.
    lat: Number(r.lat),
    lng: Number(r.lng),
    addressLine1: r.addressLine1,
    postalCode: r.postalCode,
    city: r.city,
    company: {
      id: r.companyId,
      name: r.companyName,
      status: r.companyStatus,
      industry: r.companyIndustry,
      signalType: r.companySignalType,
      signalDetectedAt: r.companySignalDetectedAt,
      ownerId: r.companyOwnerId,
      score: r.companyScore,
    },
  }));
}

/**
 * Count sites missing coordinates — surfaced as a hint so the user
 * knows why their pin count is lower than their total site count.
 * Org-scoped only — we don't care about the company's `deletedAt` here
 * because the backfill should still try (the listing query is the one
 * that filters deleted companies).
 */
export async function countSitesWithoutGeo(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(sites)
    .where(
      and(
        eq(sites.organizationId, orgId),
        sql`(${sites.lat} is null or ${sites.lng} is null)`,
      ),
    );
  return Number(row?.c ?? 0);
}

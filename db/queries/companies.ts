import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, contacts, sites } from "@/db/schema";

export async function listCompaniesByOrg(orgId: string) {
  return getDb().query.companies.findMany({
    where: and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)),
    orderBy: [desc(companies.score), sql`${companies.signalDetectedAt} DESC NULLS LAST`, asc(companies.name)],
    limit: 200,
  });
}

/**
 * Enriched list for the mockup-aligned /companies table.
 * Returns each company with its primary site (for the address column) and its
 * top-relevance contact (for the "Contact prio" column).
 *
 * We do 3 queries instead of one mega-join because Drizzle's joins return
 * flat rows that would need post-processing anyway; this is clearer.
 */
export type CompanyListRow = Awaited<ReturnType<typeof listCompaniesByOrg>>[number] & {
  primarySite: { city: string | null; postalCode: string | null; addressLine1: string | null } | null;
  topContact: {
    id: string;
    kind: "person" | "generic";
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    email: string | null;
  } | null;
};

/** Special sentinel for the `ownerId` filter meaning "owner_id IS NULL". */
export const UNASSIGNED_COMPANY_OWNER = "unassigned" as const;
/** Same idea for industry / signal — the user may want to surface
 *  companies where the field is empty as a category in itself. */
export const UNASSIGNED_INDUSTRY = "unassigned" as const;
export const NO_SIGNAL = "none" as const;

export async function listCompaniesByOrgEnriched(
  orgId: string,
  filters?: {
    /** UUID of a member, `"unassigned"` to match NULL owner_id, or
     *  undefined to skip the filter. */
    ownerId?: string;
    /** Exact industry value, `"unassigned"` for NULL, or undefined. */
    industry?: string;
    /** Exact signal_type value, `"none"` for NULL, or undefined. */
    signal?: string;
    /** Exact status value, or undefined. No "unassigned" because
     *  `status` is NOT NULL on the schema (defaults to "to_qualify"). */
    status?: string;
  },
): Promise<CompanyListRow[]> {
  const db = getDb();

  const ownerFilter = !filters?.ownerId
    ? undefined
    : filters.ownerId === UNASSIGNED_COMPANY_OWNER
      ? isNull(companies.ownerId)
      : eq(companies.ownerId, filters.ownerId);
  const industryFilter = !filters?.industry
    ? undefined
    : filters.industry === UNASSIGNED_INDUSTRY
      ? isNull(companies.industry)
      : eq(companies.industry, filters.industry);
  const signalFilter = !filters?.signal
    ? undefined
    : filters.signal === NO_SIGNAL
      ? isNull(companies.signalType)
      : eq(companies.signalType, filters.signal);
  const statusFilter = filters?.status ? eq(companies.status, filters.status) : undefined;

  const cos = await db.query.companies.findMany({
    where: and(
      eq(companies.organizationId, orgId),
      isNull(companies.deletedAt),
      ownerFilter,
      industryFilter,
      signalFilter,
      statusFilter,
    ),
    orderBy: [desc(companies.score), sql`${companies.signalDetectedAt} DESC NULLS LAST`, asc(companies.name)],
    limit: 200,
  });
  if (cos.length === 0) return [];

  const ids = cos.map((c) => c.id);

  const primarySites = await db.query.sites.findMany({
    where: and(eq(sites.organizationId, orgId), eq(sites.isPrimary, true)),
    columns: { companyId: true, city: true, postalCode: true, addressLine1: true },
  });
  const siteByCompany = new Map(primarySites.map((s) => [s.companyId, s]));

  const allContacts = await db.query.contacts.findMany({
    where: and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)),
    columns: { companyId: true, id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true, relevance: true },
    orderBy: [desc(contacts.relevance), asc(contacts.lastName)],
  });
  const topByCompany = new Map<string, (typeof allContacts)[number]>();
  for (const c of allContacts) {
    if (!ids.includes(c.companyId)) continue;
    if (!topByCompany.has(c.companyId)) topByCompany.set(c.companyId, c);
  }

  return cos.map((c) => ({
    ...c,
    primarySite: siteByCompany.get(c.id) ?? null,
    topContact: topByCompany.get(c.id) ?? null,
  }));
}

export async function countCompaniesByOrg(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(companies)
    .where(and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)));
  return row?.c ?? 0;
}

/** Distinct non-empty `industry` values present in the org. Powers the
 *  Industry filter dropdown on /companies. Sorted alphabetically.
 *  `industry` is a free-text column — orgs that haven't standardised
 *  their data will see typo variants in the list ; that's a feature
 *  (users can spot and clean them) rather than a bug. */
export async function listCompanyIndustriesByOrg(orgId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ industry: companies.industry })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, orgId),
        isNull(companies.deletedAt),
        sql`${companies.industry} is not null and ${companies.industry} <> ''`,
      ),
    )
    .orderBy(asc(companies.industry));
  return rows.map((r) => r.industry).filter((v): v is string => v != null);
}

/** Distinct non-empty `signal_type` values present in the org. */
export async function listCompanySignalsByOrg(orgId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ signalType: companies.signalType })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, orgId),
        isNull(companies.deletedAt),
        sql`${companies.signalType} is not null and ${companies.signalType} <> ''`,
      ),
    )
    .orderBy(asc(companies.signalType));
  return rows.map((r) => r.signalType).filter((v): v is string => v != null);
}

/** Sidebar split-counter : companies owned by a specific user inside the
 *  active org. NULL owner_id (= unassigned) doesn't count. */
export async function countCompaniesOwnedBy(
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, orgId),
        isNull(companies.deletedAt),
        eq(companies.ownerId, userId),
      ),
    );
  return row?.c ?? 0;
}

export async function getCompanyById(orgId: string, companyId: string) {
  return getDb().query.companies.findFirst({
    where: and(
      eq(companies.id, companyId),
      eq(companies.organizationId, orgId),
      isNull(companies.deletedAt),
    ),
  });
}

export async function getCompanyWithDetails(orgId: string, companyId: string) {
  return getDb().query.companies.findFirst({
    where: and(
      eq(companies.id, companyId),
      eq(companies.organizationId, orgId),
      isNull(companies.deletedAt),
    ),
    with: {
      sites: {
        orderBy: [desc(sites.isPrimary), asc(sites.name)],
      },
      contacts: {
        where: isNull(contacts.deletedAt),
        orderBy: [desc(contacts.relevance), asc(contacts.lastName)],
      },
      parent: true,
      children: {
        where: isNull(companies.deletedAt),
        orderBy: [asc(companies.name)],
      },
    },
  });
}

/**
 * Stats for the "Relations · Groupe" card : sites, active prospects, and
 * clients across the whole group (root company + its direct children).
 *
 * Group root is `parent` if the current company has one, otherwise the
 * company itself — that's the caller's responsibility (we just trust
 * `rootCompanyId`).
 *
 * Two DB roundtrips :
 *   1. group members — root OR parent === root, filtered at SQL level
 *   2. site count — `COUNT(*) WHERE company_id IN (...)` at SQL level
 *
 * Previously fetched every company + every site of the org and filtered
 * in JS (O(org size) instead of O(group size)).
 */
export async function getGroupStats(
  orgId: string,
  rootCompanyId: string,
): Promise<{ groupSize: number; sites: number; activeProspects: number; clients: number }> {
  const db = getDb();

  // 1. Pull the root + its direct children in a single query.
  const groupMembers = await db
    .select({
      id: companies.id,
      status: companies.status,
      relationshipType: companies.relationshipType,
    })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, orgId),
        isNull(companies.deletedAt),
        or(
          eq(companies.id, rootCompanyId),
          eq(companies.parentId, rootCompanyId),
        ),
      ),
    );

  const groupIds = groupMembers.map((c) => c.id);
  const groupSize = groupMembers.length;
  const activeProspects = groupMembers.filter(
    (c) => !["client", "former_client", "not_interested"].includes(c.status),
  ).length;
  const clients = groupMembers.filter((c) => c.relationshipType === "client").length;

  // 2. Count sites at the SQL level — IN (...) filtered by org for RLS belt-and-braces.
  let sitesCount = 0;
  if (groupIds.length > 0) {
    const [row] = await db
      .select({ c: count() })
      .from(sites)
      .where(
        and(
          eq(sites.organizationId, orgId),
          inArray(sites.companyId, groupIds),
        ),
      );
    sitesCount = row?.c ?? 0;
  }

  return {
    groupSize,
    sites: sitesCount,
    activeProspects,
    clients,
  };
}

import "server-only";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
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
  topContact: { firstName: string; lastName: string; jobTitle: string | null } | null;
};

export async function listCompaniesByOrgEnriched(orgId: string): Promise<CompanyListRow[]> {
  const db = getDb();

  const cos = await db.query.companies.findMany({
    where: and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)),
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
    columns: { companyId: true, firstName: true, lastName: true, jobTitle: true, relevance: true },
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
 * Stats for the "Relations · Groupe" card: sites, active prospects, and L&G clients
 * across the whole group (root company + its direct children).
 *
 * Group root is `parent` if the current company has one, otherwise the company itself.
 */
export async function getGroupStats(
  orgId: string,
  rootCompanyId: string,
): Promise<{ groupSize: number; sites: number; activeProspects: number; clients: number }> {
  const db = getDb();

  // All companies in the group (root + its direct children).
  const groupCompanies = await db
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
        // root OR parent === root
        // Drizzle doesn't have OR helper imported here, use sql.raw fallback
      ),
    );

  // Filter in JS for simplicity (small list).
  const inGroup = groupCompanies.filter(
    (c) => c.id === rootCompanyId,
  );
  // Also fetch children of root
  const children = await db
    .select({
      id: companies.id,
      status: companies.status,
      relationshipType: companies.relationshipType,
    })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, orgId),
        eq(companies.parentId, rootCompanyId),
        isNull(companies.deletedAt),
      ),
    );

  const all = [...inGroup, ...children];
  const groupIds = all.map((c) => c.id);

  const groupSize = all.length;
  const activeProspects = all.filter(
    (c) => !["client", "former_client", "not_interested"].includes(c.status),
  ).length;
  const clients = all.filter((c) => c.relationshipType === "client").length;

  // Count sites across the group
  let sitesCount = 0;
  if (groupIds.length > 0) {
    const sitesRows = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(eq(sites.organizationId, orgId));
    sitesCount = sitesRows.filter((s) => groupIds.includes(s.companyId)).length;
  }

  return {
    groupSize,
    sites: sitesCount,
    activeProspects,
    clients,
  };
}

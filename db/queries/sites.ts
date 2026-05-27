import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, contacts, sites } from "@/db/schema";

export async function getSiteById(orgId: string, siteId: string) {
  return getDb().query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.organizationId, orgId)),
  });
}

export async function getSiteWithDetails(orgId: string, siteId: string) {
  return getDb().query.sites.findFirst({
    where: and(eq(sites.id, siteId), eq(sites.organizationId, orgId)),
    with: {
      company: true,
      contacts: {
        where: isNull(contacts.deletedAt),
        orderBy: [desc(contacts.relevance), asc(contacts.lastName)],
      },
    },
  });
}

export async function listSitesByCompany(orgId: string, companyId: string) {
  return getDb().query.sites.findMany({
    where: and(eq(sites.organizationId, orgId), eq(sites.companyId, companyId)),
    orderBy: [desc(sites.isPrimary), asc(sites.name)],
  });
}

export async function listSitesByOrgWithCompany(orgId: string) {
  return getDb()
    .select({
      id: sites.id,
      name: sites.name,
      companyId: sites.companyId,
      companyName: companies.name,
    })
    .from(sites)
    .innerJoin(companies, eq(sites.companyId, companies.id))
    // Multi-tenant: both sides of the join must be filtered by orgId for
    // defense-in-depth (RLS is the ultimate safety net but explicit beats implicit).
    .where(and(eq(sites.organizationId, orgId), eq(companies.organizationId, orgId)))
    .orderBy(asc(companies.name), asc(sites.name));
}

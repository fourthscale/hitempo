import "server-only";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, contacts } from "@/db/schema";

export async function listContactsByOrg(
  orgId: string,
  filters?: { companyId?: string; status?: string },
) {
  const companyFilter = filters?.companyId ? eq(contacts.companyId, filters.companyId) : undefined;
  const statusFilter = filters?.status ? eq(contacts.status, filters.status) : undefined;
  return getDb()
    .select({
      contact: contacts,
      companyName: companies.name,
      companyId: companies.id,
    })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    // Multi-tenant: filter BOTH sides of the join explicitly. RLS is the safety
    // net but defense-in-depth (CLAUDE.md hard rule) requires explicit filters.
    .where(
      and(
        eq(contacts.organizationId, orgId),
        eq(companies.organizationId, orgId),
        isNull(contacts.deletedAt),
        companyFilter,
        statusFilter,
      ),
    )
    .orderBy(desc(contacts.relevance), asc(contacts.lastName))
    .limit(500);
}

/**
 * Companies (id + name) for filter dropdowns. Only those that actually have
 * at least one non-deleted contact — keeps the dropdown short for orgs that
 * pre-loaded a lot of companies but only contacts a handful.
 */
export async function listCompaniesWithContactsForOrg(orgId: string) {
  const db = getDb();
  return db
    .selectDistinct({ id: companies.id, name: companies.name })
    .from(companies)
    .innerJoin(contacts, eq(contacts.companyId, companies.id))
    .where(
      and(
        eq(companies.organizationId, orgId),
        eq(contacts.organizationId, orgId),
        isNull(contacts.deletedAt),
      ),
    )
    .orderBy(asc(companies.name));
}

export async function countContactsByOrg(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(contacts)
    .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)));
  return row?.c ?? 0;
}

export async function getContactById(orgId: string, contactId: string) {
  return getDb().query.contacts.findFirst({
    where: and(
      eq(contacts.id, contactId),
      eq(contacts.organizationId, orgId),
      isNull(contacts.deletedAt),
    ),
    with: {
      company: true,
      site: true,
    },
  });
}

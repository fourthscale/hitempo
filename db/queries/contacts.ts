import "server-only";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, contacts } from "@/db/schema";

export async function listContactsByOrg(orgId: string) {
  return getDb()
    .select({
      contact: contacts,
      companyName: companies.name,
      companyId: companies.id,
    })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)))
    .orderBy(desc(contacts.relevance), asc(contacts.lastName))
    .limit(200);
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

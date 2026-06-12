import "server-only";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, contacts } from "@/db/schema";

/** Special sentinel for the `ownerId` filter meaning "no owner anywhere
 *  in the chain" (neither the contact nor its company has one). */
export const UNASSIGNED_OWNER = "unassigned" as const;

export async function listContactsByOrg(
  orgId: string,
  filters?: {
    companyId?: string;
    status?: string;
    /** UUID of a user, the sentinel `"unassigned"`, or undefined for
     *  "no owner filter". Filters on the EFFECTIVE owner :
     *    contact.owner_id ?? company.owner_id
     *  so a contact inherits its company's owner when none is set
     *  locally. Matches what the UI renders in the Owner column. */
    ownerId?: string;
  },
) {
  const companyFilter = filters?.companyId ? eq(contacts.companyId, filters.companyId) : undefined;
  const statusFilter = filters?.status ? eq(contacts.status, filters.status) : undefined;
  // Effective owner = first non-null between contact and company. Defined
  // as a SQL expression so both the SELECT and the WHERE use the same
  // semantics (no drift between the rendered column and the filter).
  const effectiveOwner = sql<string | null>`coalesce(${contacts.ownerId}, ${companies.ownerId})`;
  const ownerFilter = !filters?.ownerId
    ? undefined
    : filters.ownerId === UNASSIGNED_OWNER
      ? sql`${effectiveOwner} is null`
      : sql`${effectiveOwner} = ${filters.ownerId}`;
  return getDb()
    .select({
      contact: contacts,
      companyName: companies.name,
      companyId: companies.id,
      effectiveOwnerId: effectiveOwner,
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
        ownerFilter,
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

/**
 * Read just the contact's current status — used by the auto-promoter to feed
 * `evaluateNextContactStatus`. Returns `null` when the contact is missing
 * (deleted, wrong org) so the caller can no-op.
 */
export async function getContactStatus(
  orgId: string,
  contactId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ status: contacts.status })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, orgId),
        eq(contacts.id, contactId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);
  return row?.status ?? null;
}

/** Update the contact's status (auto-promoter target). */
export async function setContactStatus(
  orgId: string,
  contactId: string,
  status: string,
): Promise<void> {
  await getDb()
    .update(contacts)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(contacts.organizationId, orgId), eq(contacts.id, contactId)),
    );
}

export async function countContactsByOrg(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(contacts)
    .where(and(eq(contacts.organizationId, orgId), isNull(contacts.deletedAt)));
  return row?.c ?? 0;
}

/** Sidebar split-counter : contacts whose EFFECTIVE owner is the given
 *  user. Effective = contact.owner_id ?? company.owner_id, same coalesce
 *  the listing page uses (see listContactsByOrg's `effectiveOwner`
 *  expression). Without the company fallback, contacts that inherit their
 *  owner from the company would silently miss the sidebar count and the
 *  rep's footprint would look smaller than what the listing displays. */
export async function countContactsOwnedBy(
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .where(
      and(
        eq(contacts.organizationId, orgId),
        eq(companies.organizationId, orgId),
        isNull(contacts.deletedAt),
        sql`coalesce(${contacts.ownerId}, ${companies.ownerId}) = ${userId}`,
      ),
    );
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

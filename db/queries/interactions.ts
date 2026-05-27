import "server-only";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contacts, interactions } from "@/db/schema";

export type InteractionRow = Awaited<ReturnType<typeof getInteractionsByContact>>[number];

export async function getInteractionsByContact(orgId: string, contactId: string) {
  return getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      eq(interactions.contactId, contactId),
    ),
    with: { company: { columns: { id: true, name: true } } },
    orderBy: [desc(interactions.occurredAt)],
    limit: 50,
  });
}

/**
 * Recent interactions for a company, capped at `limit` and filtered by recency
 * (defaults to 6 months). Returns the lean shape the prompt builder needs —
 * does NOT join `contact` because the prompt only references types/outcomes,
 * not contact identity (the relevant contact is already in the prompt header).
 *
 * Used by `generateMessageAction` to inject interaction history into the LLM
 * context window.
 */
export async function getRecentInteractionsForPrompt(
  orgId: string,
  companyId: string,
  opts: { limit?: number; maxAgeDays?: number } = {},
) {
  const limit = opts.limit ?? 10;
  const maxAgeDays = opts.maxAgeDays ?? 180;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  return getDb()
    .select({
      id: interactions.id,
      occurredAt: interactions.occurredAt,
      type: interactions.type,
      channel: interactions.channel,
      outcome: interactions.outcome,
      summary: interactions.summary,
      interestLevel: interactions.interestLevel,
    })
    .from(interactions)
    .where(
      and(
        eq(interactions.organizationId, orgId),
        eq(interactions.companyId, companyId),
        gte(interactions.occurredAt, cutoff),
      ),
    )
    .orderBy(desc(interactions.occurredAt))
    .limit(limit);
}

export async function getInteractionsByCompany(orgId: string, companyId: string) {
  return getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      eq(interactions.companyId, companyId),
    ),
    with: {
      contact: { columns: { id: true, firstName: true, lastName: true, jobTitle: true } },
    },
    orderBy: [desc(interactions.occurredAt)],
    limit: 50,
  });
}

export async function getRecentInteractionsByOrg(orgId: string, limit = 5) {
  return getDb().query.interactions.findMany({
    where: eq(interactions.organizationId, orgId),
    with: {
      company: { columns: { id: true, name: true } },
      contact: { columns: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [desc(interactions.occurredAt)],
    limit,
  });
}

export async function countInteractionsByCompany(orgId: string, companyId: string): Promise<number> {
  const rows = await getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      eq(interactions.companyId, companyId),
    ),
    columns: { id: true },
  });
  return rows.length;
}

export async function logInteraction(
  orgId: string,
  userId: string,
  data: {
    companyId: string;
    contactId?: string | null;
    siteId?: string | null;
    taskId?: string | null;
    type: typeof interactions.$inferInsert["type"];
    channel: typeof interactions.$inferInsert["channel"];
    outcome?: typeof interactions.$inferInsert["outcome"];
    summary?: string | null;
    interestLevel?: number | null;
    occurredAt: Date;
  },
) {
  const db = getDb();

  const [row] = await db
    .insert(interactions)
    .values({
      organizationId: orgId,
      companyId: data.companyId,
      contactId: data.contactId ?? null,
      siteId: data.siteId ?? null,
      taskId: data.taskId ?? null,
      type: data.type,
      channel: data.channel,
      outcome: data.outcome ?? null,
      summary: data.summary ?? null,
      interestLevel: data.interestLevel ?? null,
      occurredAt: data.occurredAt,
      userId,
    })
    .returning();

  if (data.contactId && row) {
    await db
      .update(contacts)
      .set({ lastContactedAt: data.occurredAt, updatedAt: new Date() })
      .where(and(eq(contacts.id, data.contactId), eq(contacts.organizationId, orgId)));
  }

  return row;
}

/**
 * Updates the outcome of an existing interaction (or clears it with `null`).
 * Multi-tenant safe : filters by organizationId so cross-org updates are
 * impossible even if RLS were bypassed.
 *
 * Returns the row's companyId / contactId / taskId so the action can know
 * which paths to revalidate.
 */
export async function updateInteractionOutcome(
  orgId: string,
  interactionId: string,
  outcome: typeof interactions.$inferInsert["outcome"] | null,
) {
  const [row] = await getDb()
    .update(interactions)
    .set({ outcome: outcome ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(interactions.id, interactionId),
        eq(interactions.organizationId, orgId),
      ),
    )
    .returning({
      companyId: interactions.companyId,
      contactId: interactions.contactId,
      taskId: interactions.taskId,
    });
  return row ?? null;
}

export async function countInteractionsByOrg(orgId: string): Promise<number> {
  const rows = await getDb().query.interactions.findMany({
    where: eq(interactions.organizationId, orgId),
    columns: { id: true },
  });
  return rows.length;
}

export async function getWeeklyInteractionStats(
  orgId: string,
): Promise<{ doneThisWeek: number; responseRate: number }> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday

  const recentRows = await getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
    ),
    columns: { outcome: true, occurredAt: true },
    orderBy: [asc(interactions.occurredAt)],
  });

  const doneThisWeek = recentRows.filter(
    (r) => r.occurredAt >= startOfWeek,
  ).length;

  const total = recentRows.length;
  const positives = recentRows.filter(
    (r) => r.outcome === "positive_reply" || r.outcome === "rdv_scheduled",
  ).length;
  const responseRate = total > 0 ? Math.round((positives / total) * 100) : 0;

  return { doneThisWeek, responseRate };
}

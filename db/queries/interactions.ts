import "server-only";
import { and, asc, count, desc, eq, gte, isNull } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
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

export async function getInteractionsByTask(orgId: string, taskId: string) {
  return getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      eq(interactions.taskId, taskId),
    ),
    with: {
      company: { columns: { id: true, name: true } },
      contact: { columns: { id: true, kind: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [desc(interactions.occurredAt)],
    limit: 50,
  });
}

export async function getInteractionsByCompany(orgId: string, companyId: string) {
  return getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      eq(interactions.companyId, companyId),
    ),
    with: {
      contact: { columns: { id: true, kind: true, firstName: true, lastName: true, jobTitle: true, email: true } },
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
      contact: { columns: { id: true, kind: true, firstName: true, lastName: true, email: true } },
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
    /** Lifecycle stage of the interaction. Outbound rows default to "sent"
     *  via the action layer ; reply rows are left null. */
    status?: typeof interactions.$inferInsert["status"];
    /** FK back to the `messages` row this interaction reflects. Set for outbound
     *  events created on Send via Gmail / Log interaction. */
    messageId?: string | null;
    /** Optional JSON metadata. Used by the Gmail reply poller to store
     *  `{ kind, gmail_thread_id, gmail_message_id, original_message_id }`. */
    metadata?: Record<string, unknown>;
  },
  /** Optional DB override — pass the admin pool from background jobs that
   *  run outside an authenticated user session (Inngest crons, migrations). */
  dbOverride?: Db,
) {
  const db = dbOverride ?? getDb();

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
      status: data.status ?? null,
      messageId: data.messageId ?? null,
      metadata: data.metadata ?? {},
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

/**
 * Counts `email_received` interactions that don't yet have an `outcome` set
 * — the user's pending classification queue. These are the rows the
 * "Réponses à classer" KPI on the dashboard surfaces : reading the reply
 * snippet and picking positive_reply / negative_reply / rdv / etc is the
 * core daily loop for the commercial.
 */
export async function countRepliesToClassifyByOrg(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(interactions)
    .where(
      and(
        eq(interactions.organizationId, orgId),
        eq(interactions.type, "email_received"),
        isNull(interactions.outcome),
      ),
    );
  return row?.c ?? 0;
}

/**
 * Counts outbound interactions that have been sent but haven't yet been
 * marked as `responded` — i.e. mail / call / visit "still in flight" from
 * the rep's perspective. Filters by assignee/sender so each rep sees their
 * own backlog. Useful as an early-warning KPI : when this number balloons,
 * it's time to relance the oldest ones.
 */
export async function countAwaitingReplyByOrg(
  orgId: string,
  userId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(interactions)
    .where(
      and(
        eq(interactions.organizationId, orgId),
        eq(interactions.userId, userId),
        eq(interactions.status, "sent"),
      ),
    );
  return row?.c ?? 0;
}

/**
 * Real response-rate metric : compares the last 30-day rolling window to
 * the prior 30-day window. Uses the new `status` enum (responded vs sent)
 * so it only counts outbound interactions where we have ground truth.
 *
 * Returns the current rate as a percentage and the delta in points
 * versus the previous window. The delta is `null` when the previous
 * window has zero outbound activity (avoids meaningless ↑∞ %).
 */
export async function getResponseRateLast30Days(
  orgId: string,
): Promise<{ rate: number; deltaPoints: number | null; sent: number; responded: number }> {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const start30 = new Date(now.getTime() - 30 * day);
  const start60 = new Date(now.getTime() - 60 * day);

  const rows = await getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      gte(interactions.occurredAt, start60),
    ),
    columns: { status: true, occurredAt: true },
  });

  const inRange = (r: { occurredAt: Date }, from: Date, to: Date) =>
    r.occurredAt >= from && r.occurredAt < to;

  /**
   * Returns `null` when the window has zero outbound activity (sent or responded),
   * so callers can distinguish "no data" from "0% rate".
   * `sent` here is the total outbound volume in the window — i.e. responded rows
   * count too, since a "responded" message was once sent.
   */
  function windowStats(
    rows: Array<{ status: string | null; occurredAt: Date }>,
    from: Date,
    to: Date,
  ): { rate: number; sent: number; responded: number } | null {
    const slice = rows.filter(
      (r) => inRange(r, from, to) && (r.status === "sent" || r.status === "responded"),
    );
    if (slice.length === 0) return null;
    const responded = slice.filter((r) => r.status === "responded").length;
    return {
      rate: Math.round((responded / slice.length) * 100),
      sent: slice.length,
      responded,
    };
  }

  const currentStats = windowStats(rows, start30, now);
  const previousStats = windowStats(rows, start60, start30);

  const current = currentStats?.rate ?? 0;
  const deltaPoints = previousStats == null ? null : current - previousStats.rate;

  return {
    rate: current,
    deltaPoints,
    sent: currentStats?.sent ?? 0,
    responded: currentStats?.responded ?? 0,
  };
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

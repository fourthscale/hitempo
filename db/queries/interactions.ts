import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { contacts, interactions, messages, tasks } from "@/db/schema";
import { AUTO_APPLY_THRESHOLD } from "@/lib/ai/classification/thresholds";

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
  opts: {
    limit?: number;
    maxAgeDays?: number;
    /**
     * Sprint 12 — when set, only return interactions linked (via
     * outbound message → task) to this sequence enrolment. Used by the
     * AI message generator to keep the prompt scoped to the current
     * sequence (avoids "replying" to parallel out-of-sequence threads).
     * Omit to get the full company history (legacy default).
     */
    sequenceEnrolmentId?: string;
  } = {},
) {
  const limit = opts.limit ?? 10;
  const maxAgeDays = opts.maxAgeDays ?? 180;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  // No scope → fast path : no joins, same query as before sprint 12.
  if (!opts.sequenceEnrolmentId) {
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

  // Scoped : interactions whose underlying outbound message belongs to
  // a task tagged with the current enrolment id. Chain
  //   interactions.messageId → messages.taskId → tasks.sequenceEnrolmentId
  // Same join chain as the predicate evaluator's per-sequence facts
  // (sequence-engine query) so the two stay consistent.
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
    .innerJoin(messages, eq(messages.id, interactions.messageId))
    .innerJoin(tasks, eq(tasks.id, messages.taskId))
    .where(
      and(
        eq(interactions.organizationId, orgId),
        eq(interactions.companyId, companyId),
        gte(interactions.occurredAt, cutoff),
        eq(tasks.sequenceEnrolmentId, opts.sequenceEnrolmentId),
      ),
    )
    .orderBy(desc(interactions.occurredAt))
    .limit(limit);
}

export async function getInteractionsByTask(orgId: string, taskId: string) {
  // Two link paths converge into this view :
  //   1. `interactions.taskId = X`        → manual logs against the task,
  //                                         outbound emails sent via the task
  //                                         (the action layer sets taskId).
  //   2. `interactions.messageId IN (...)` → inbound Gmail replies. The poller
  //                                          attaches the reply to the original
  //                                          outbound's messageId, but the
  //                                          interaction itself has no taskId.
  //
  // We resolve (2) by fetching the message ids owned by this task, then OR-ing
  // both conditions on the interactions filter. Two cheap queries beats a
  // brittle 3-way join.
  const db = getDb();
  const taskMessages = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.organizationId, orgId), eq(messages.taskId, taskId)));
  const messageIds = taskMessages.map((m) => m.id);

  return db.query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      messageIds.length > 0
        ? or(
            eq(interactions.taskId, taskId),
            inArray(interactions.messageId, messageIds),
          )
        : eq(interactions.taskId, taskId),
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
 * Sprint 12 phase 5 — outbound activity grouped by channel over the
 * last 7 days. Feeds the dashboard's "Vos canaux de prospection" donut
 * — gives the sale an instant read on whether they're balanced across
 * digital and field, which is hitempo's positioning wedge.
 *
 * Excludes `email_received` (inbound) ; everything else is treated as
 * outbound effort. Buckets video into "other" (rare, not a primary
 * prospection channel for the Léon & George ICP).
 */
export async function getOutboundChannelsLast7Days(
  orgId: string,
  userId: string,
): Promise<{ email: number; linkedin: number; phone: number; visit: number; other: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await getDb()
    .select({
      channel: interactions.channel,
      c: count(),
    })
    .from(interactions)
    .where(
      and(
        eq(interactions.organizationId, orgId),
        eq(interactions.userId, userId),
        gte(interactions.occurredAt, sevenDaysAgo),
        // Exclude inbound rows ; everything else is outbound activity.
        ne(interactions.type, "email_received"),
      ),
    )
    .groupBy(interactions.channel);

  const out = { email: 0, linkedin: 0, phone: 0, visit: 0, other: 0 };
  for (const row of rows) {
    switch (row.channel) {
      case "email":     out.email    += row.c; break;
      case "linkedin":  out.linkedin += row.c; break;
      case "phone":     out.phone    += row.c; break;
      case "in_person": out.visit    += row.c; break;
      default:          out.other    += row.c; break;
    }
  }
  return out;
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

/**
 * Sprint 11.5 / Slice C — "Pending review" inbox.
 *
 * The LLM classifier ran (`ai_processed_at` set) but with a confidence
 * below the auto-apply tier, so it stored a label/reasoning WITHOUT
 * touching the outcome. These rows are now waiting for a sale to confirm
 * or override the AI's guess. We also exclude `label = 'unknown'` rows :
 * the classifier itself said it couldn't decide, so they're routed via
 * the existing "Réponses à classer" KPI flow instead.
 */
export async function getPendingReviewInteractions(orgId: string, limit = 50) {
  return getDb().query.interactions.findMany({
    where: and(
      eq(interactions.organizationId, orgId),
      eq(interactions.type, "email_received"),
      isNull(interactions.outcome),
      isNotNull(interactions.aiProcessedAt),
      isNotNull(interactions.aiIntentLabel),
      ne(interactions.aiIntentLabel, "unknown"),
      lt(interactions.aiIntentConfidence, AUTO_APPLY_THRESHOLD.toString()),
    ),
    with: {
      company: { columns: { id: true, name: true } },
      contact: { columns: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: [desc(interactions.occurredAt)],
    limit,
  });
}

export async function countPendingReviewByOrg(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: count() })
    .from(interactions)
    .where(
      and(
        eq(interactions.organizationId, orgId),
        eq(interactions.type, "email_received"),
        isNull(interactions.outcome),
        isNotNull(interactions.aiProcessedAt),
        isNotNull(interactions.aiIntentLabel),
        ne(interactions.aiIntentLabel, "unknown"),
        lt(interactions.aiIntentConfidence, AUTO_APPLY_THRESHOLD.toString()),
      ),
    );
  return row?.c ?? 0;
}

/**
 * Lean fetch for the Slice B classifier : just enough to build the prompt
 * (snippet + locale hint) and gate idempotency (aiProcessedAt).
 *
 * Falls back to the contact's preferredLanguage when the interaction itself
 * has no locale (it doesn't — locale is a contact-level attribute). The
 * caller defaults to "en" if both are missing.
 */
export async function getInteractionForClassification(
  orgId: string,
  interactionId: string,
) {
  const row = await getDb().query.interactions.findFirst({
    where: and(
      eq(interactions.id, interactionId),
      eq(interactions.organizationId, orgId),
    ),
    columns: {
      id: true,
      organizationId: true,
      contactId: true,
      type: true,
      summary: true,
      subject: true,
      userId: true,
      aiProcessedAt: true,
    },
    with: {
      contact: { columns: { preferredLanguage: true } },
    },
  });
  return row ?? null;
}

/**
 * Persists a classification result on an interaction row. Always sets
 * `ai_processed_at = now()` (idempotency marker, even on failure paths
 * where label="unknown" and confidence=0). Optionally bumps `outcome`
 * if the caller decided the confidence tier was high enough.
 */
export async function applyInteractionClassification(
  orgId: string,
  interactionId: string,
  patch: {
    label: string;
    confidence: number;
    reasoning: string;
    /** When set, overwrites `interaction.outcome`. */
    outcome?: typeof interactions.$inferInsert["outcome"] | null;
  },
  db: Db = getDb(),
): Promise<void> {
  const update: Partial<typeof interactions.$inferInsert> = {
    aiIntentLabel: patch.label,
    aiIntentConfidence: patch.confidence.toFixed(3),
    aiIntentReasoning: patch.reasoning,
    aiProcessedAt: new Date(),
    updatedAt: new Date(),
  };
  if (patch.outcome !== undefined) {
    update.outcome = patch.outcome;
  }
  await db
    .update(interactions)
    .set(update)
    .where(
      and(
        eq(interactions.id, interactionId),
        eq(interactions.organizationId, orgId),
      ),
    );
}

import "server-only";

import { and, count, eq, max, or } from "drizzle-orm";

import { getDb } from "@/db/client";
import { companies, interactions, tasks } from "@/db/schema";

import type { ScoringInputs, ScoreBreakdown } from "./scoring-types";

/**
 * Data-access contract the `ScoringEngine` depends on. Pulling DB work
 * behind this interface means the engine can be unit-tested with an
 * in-memory fake — no Drizzle, no postgres pool — while production
 * uses the `DbScoringRepository` impl below.
 */
export interface ScoringRepository {
  /**
   * Loads the full set of scoring inputs for a company. Returns `null` when
   * the company doesn't exist in this org (defensive multi-tenant guard).
   */
  getInputs(orgId: string, companyId: string): Promise<ScoringInputs | null>;

  /**
   * Persists the computed score and full breakdown back onto `companies`.
   * Tightly multi-tenant : the WHERE clause must always include `organizationId`.
   */
  persistScore(
    orgId: string,
    companyId: string,
    total: number,
    breakdown: ScoreBreakdown,
  ): Promise<void>;
}

/** Production impl — drives `getDb()`, scoped to the active tenant. */
export class DbScoringRepository implements ScoringRepository {
  public async getInputs(
    orgId: string,
    companyId: string,
  ): Promise<ScoringInputs | null> {
    const db = getDb();

    const company = await db.query.companies.findFirst({
      where: and(
        eq(companies.id, companyId),
        eq(companies.organizationId, orgId),
      ),
      columns: {
        standing: true,
        signalType: true,
        signalDetectedAt: true,
        primaryContactId: true,
      },
    });
    if (!company) return null;

    const [interactionStats] = await db
      .select({ total: count(), lastAt: max(interactions.occurredAt) })
      .from(interactions)
      .where(
        and(
          eq(interactions.companyId, companyId),
          eq(interactions.organizationId, orgId),
        ),
      );

    const [taskStats] = await db
      .select({ open: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.companyId, companyId),
          eq(tasks.organizationId, orgId),
          or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
        ),
      );

    return {
      standing: company.standing,
      signalType: company.signalType,
      signalDetectedAt: company.signalDetectedAt,
      interactionCount: interactionStats?.total ?? 0,
      lastInteractionAt: interactionStats?.lastAt ?? null,
      openTaskCount: taskStats?.open ?? 0,
      hasPrimaryContact: company.primaryContactId != null,
    };
  }

  public async persistScore(
    orgId: string,
    companyId: string,
    total: number,
    breakdown: ScoreBreakdown,
  ): Promise<void> {
    await getDb()
      .update(companies)
      .set({ score: total, scoreBreakdown: breakdown, updatedAt: new Date() })
      .where(
        and(eq(companies.id, companyId), eq(companies.organizationId, orgId)),
      );
  }
}

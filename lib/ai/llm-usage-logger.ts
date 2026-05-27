import "server-only";

import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { llmUsage } from "@/db/schema";
import type { ProviderName } from "./llm-strategy";

/**
 * One row written to the `llm_usage` audit table per LLM call (success or error).
 *
 * `LlmUsageLogger` is the abstraction the Facade depends on. Production uses
 * `DbLlmUsageLogger` (persists to Postgres) ; tests use `NoopLlmUsageLogger`
 * (returns a fake record without touching the DB).
 */
export type LlmUsageEntry = {
  organizationId: string;
  userId: string | null;
  type: LlmUsageType;

  provider: ProviderName;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  durationMs: number | null;

  relatedEntityType?: string | null;
  relatedEntityId?: string | null;

  status: "success" | "error";
  errorCode?: string | null;
};

export type LlmUsageType =
  | "outbound_message"
  | "brand_brief_generation"
  | "interaction_summary"
  | "company_enrichment"
  | "signal_extraction"
  | "other";

export type LlmUsageRecord = {
  id: string;
  createdAt: Date;
};

export interface LlmUsageLogger {
  log(entry: LlmUsageEntry): Promise<LlmUsageRecord>;
  /**
   * Update the polymorphic backref on an already-logged row. Used by callers
   * who didn't know the related entity ID at log time (e.g. a message that
   * gets inserted AFTER the LLM call, then patches its FK back to llm_usage).
   */
  patchRelatedEntity(usageId: string, type: string, id: string): Promise<void>;
}

/**
 * Production logger : inserts into the `llm_usage` table via Drizzle.
 *
 * Multi-tenant safety is enforced by RLS at the Postgres level — the row
 * must carry an organizationId the current user can access. Code that calls
 * the logger is already inside an action that resolved `getActiveOrg()`,
 * so the orgId here is always trusted.
 */
export class DbLlmUsageLogger implements LlmUsageLogger {
  public async log(entry: LlmUsageEntry): Promise<LlmUsageRecord> {
    const [row] = await getDb()
      .insert(llmUsage)
      .values({
        organizationId: entry.organizationId,
        userId: entry.userId,
        type: entry.type,
        provider: entry.provider,
        model: entry.model,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        costCents: entry.costCents,
        durationMs: entry.durationMs,
        relatedEntityType: entry.relatedEntityType ?? null,
        relatedEntityId: entry.relatedEntityId ?? null,
        status: entry.status,
        errorCode: entry.errorCode ?? null,
      })
      .returning({ id: llmUsage.id, createdAt: llmUsage.createdAt });

    if (!row) {
      throw new Error("DbLlmUsageLogger: insert returned no row");
    }
    return { id: row.id, createdAt: row.createdAt };
  }

  public async patchRelatedEntity(
    usageId: string,
    type: string,
    id: string,
  ): Promise<void> {
    const { eq } = await import("drizzle-orm");
    await getDb()
      .update(llmUsage)
      .set({ relatedEntityType: type, relatedEntityId: id })
      .where(eq(llmUsage.id, usageId));
  }
}

/**
 * Test logger : records calls in memory, returns deterministic-ish records
 * (real UUIDs but no persistence). Lets the Facade tests assert what got
 * logged without spinning up a database.
 */
export class NoopLlmUsageLogger implements LlmUsageLogger {
  public readonly entries: LlmUsageEntry[] = [];
  public readonly patches: Array<{ usageId: string; type: string; id: string }> = [];

  public async log(entry: LlmUsageEntry): Promise<LlmUsageRecord> {
    this.entries.push(entry);
    return { id: randomUUID(), createdAt: new Date() };
  }

  public async patchRelatedEntity(usageId: string, type: string, id: string): Promise<void> {
    this.patches.push({ usageId, type, id });
  }
}

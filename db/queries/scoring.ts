import "server-only";
import { and, eq, or, count, max } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, interactions, tasks } from "@/db/schema";
import type { ScoringInputs } from "@/lib/scoring/compute";

export async function getScoringInputsByCompany(
  orgId: string,
  companyId: string,
): Promise<ScoringInputs | null> {
  const company = await getDb().query.companies.findFirst({
    where: and(eq(companies.id, companyId), eq(companies.organizationId, orgId)),
    columns: {
      standing: true,
      signalType: true,
      signalDetectedAt: true,
      primaryContactId: true,
    },
  });

  if (!company) return null;

  const db = getDb();

  const [interactionStats] = await db
    .select({ total: count(), lastAt: max(interactions.occurredAt) })
    .from(interactions)
    .where(and(eq(interactions.companyId, companyId), eq(interactions.organizationId, orgId)));

  const [taskStats] = await db
    .select({ open: count() })
    .from(tasks)
    .where(and(
      eq(tasks.companyId, companyId),
      eq(tasks.organizationId, orgId),
      or(eq(tasks.status, "pending"), eq(tasks.status, "in_progress")),
    ));

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

import "server-only";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { getScoringInputsByCompany } from "@/db/queries/scoring";
import { computeCompanyScore } from "@/lib/scoring/compute";

export async function recomputeCompanyScore(orgId: string, companyId: string): Promise<void> {
  const inputs = await getScoringInputsByCompany(orgId, companyId);
  if (!inputs) return;

  const breakdown = computeCompanyScore(inputs);

  await getDb()
    .update(companies)
    .set({ score: breakdown.total, scoreBreakdown: breakdown, updatedAt: new Date() })
    .where(and(eq(companies.id, companyId), eq(companies.organizationId, orgId)));
}

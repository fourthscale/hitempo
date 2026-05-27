import "server-only";

import { ScoringEngineFactory } from "./scoring-engine-factory";

/**
 * Backwards-compatible facade over `ScoringEngine`.
 *
 * Existing call sites (`lib/actions/companies.ts`, `tasks.ts`, `interactions.ts`,
 * `scoring.ts`) keep importing this named function ; new code can call the
 * engine directly via `ScoringEngineFactory.getInstance().recompute(...)`.
 */
export async function recomputeCompanyScore(
  orgId: string,
  companyId: string,
): Promise<void> {
  await ScoringEngineFactory.getInstance().recompute(orgId, companyId);
}

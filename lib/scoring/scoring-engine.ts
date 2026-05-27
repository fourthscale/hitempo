import "server-only";

import type { ScoringRepository } from "./scoring-repository";
import type { ScoringStrategy } from "./scoring-strategy";
import type { ScoreBreakdown } from "./scoring-types";

/**
 * Facade orchestrating one "recompute the score for company X" workflow.
 *
 * Composes :
 *   - a `ScoringStrategy` — the pure formula (currently `DefaultScoringStrategy`)
 *   - a `ScoringRepository` — DB reads (load inputs) + writes (persist score)
 *
 * Server actions and Inngest jobs go through this Facade rather than calling
 * the strategy + DB queries directly, so swapping the strategy or the data
 * layer never ripples through the call sites.
 */
export class ScoringEngine {
  constructor(
    private readonly strategy: ScoringStrategy,
    private readonly repository: ScoringRepository,
  ) {}

  /**
   * Fetches scoring inputs, runs the active strategy, persists the result.
   * Returns the breakdown on success ; `null` if the company doesn't resolve
   * (we never throw on "not found" — recompute is best-effort background work).
   */
  public async recompute(
    orgId: string,
    companyId: string,
  ): Promise<ScoreBreakdown | null> {
    const inputs = await this.repository.getInputs(orgId, companyId);
    if (!inputs) return null;

    const breakdown = this.strategy.score(inputs);
    await this.repository.persistScore(
      orgId,
      companyId,
      breakdown.total,
      breakdown,
    );
    return breakdown;
  }
}

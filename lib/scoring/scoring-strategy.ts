/**
 * Contract every scoring algorithm honors.
 *
 * Scoring is a swappable concern by design : tomorrow we'll want per-org
 * weighting, per-vertical heuristics, or LLM-assisted scoring strategies.
 * Today there's a single `DefaultScoringStrategy`, but consumers always
 * receive the work through this interface — the call sites never know
 * which strategy is active.
 *
 * Implementations must be pure : same inputs + same `now` => same output.
 * No DB access, no I/O.
 */

import type { ScoringInputs, ScoreBreakdown } from "./scoring-types";

export interface ScoringStrategy {
  /** Stable identifier surfaced in `companies.scoreBreakdown` for telemetry. */
  readonly name: string;

  /**
   * Returns the full breakdown (per-dimension points + total) for a company.
   * `now` is injectable for deterministic tests ; production callers omit it.
   */
  score(inputs: ScoringInputs, now?: Date): ScoreBreakdown;
}

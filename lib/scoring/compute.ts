/**
 * Backwards-compatible facade over the Strategy layer.
 *
 * The class layer (`ScoringStrategy` + `DefaultScoringStrategy`) is the real
 * implementation ; this module keeps the historical named exports so existing
 * call sites and tests don't need to change.
 *
 * New code should depend on `ScoringStrategy` (interface) or call the
 * `ScoringEngine` Facade for the full read-compute-persist workflow.
 */

import { DefaultScoringStrategy } from "./strategies/default-scoring-strategy";

export type { ScoringInputs, ScoreBreakdown } from "./scoring-types";
import type { ScoringInputs, ScoreBreakdown } from "./scoring-types";

const defaultStrategy = new DefaultScoringStrategy();

/**
 * Pure scoring function — delegates to `DefaultScoringStrategy`. Kept as a
 * named export because :
 *   - tests reference it (`tests/scoring/compute.test.ts`)
 *   - server code can import a pure version without going through the engine
 */
export function computeCompanyScore(
  inputs: ScoringInputs,
  now: Date = new Date(),
): ScoreBreakdown {
  return defaultStrategy.score(inputs, now);
}

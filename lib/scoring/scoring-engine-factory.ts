import "server-only";

import { ScoringEngine } from "./scoring-engine";
import { DbScoringRepository } from "./scoring-repository";
import { DefaultScoringStrategy } from "./strategies/default-scoring-strategy";

/**
 * Lazy singleton factory for the production `ScoringEngine`.
 *
 * Composes the canonical pair :
 *   - strategy   = `DefaultScoringStrategy` (sprint 06 rules)
 *   - repository = `DbScoringRepository`    (Drizzle-backed, RLS pool)
 *
 * Server actions call `ScoringEngineFactory.getInstance()`.
 * Tests can call `setInstance()` / `reset()` to inject a mocked engine.
 */
export class ScoringEngineFactory {
  private static cached: ScoringEngine | null = null;

  public static getInstance(): ScoringEngine {
    if (this.cached) return this.cached;
    this.cached = new ScoringEngine(
      new DefaultScoringStrategy(),
      new DbScoringRepository(),
    );
    return this.cached;
  }

  public static setInstance(engine: ScoringEngine): void {
    this.cached = engine;
  }

  public static reset(): void {
    this.cached = null;
  }
}

import "server-only";

import { LlmGenerationService } from "./llm-generation-service";
import { LlmStrategyProviderFactory } from "./llm-strategy-provider-factory";
import { DbLlmUsageLogger } from "./llm-usage-logger";

/**
 * Lazy singleton factory for the LLM generation service.
 *
 * Server actions call `LlmGenerationServiceFactory.getInstance()` to get
 * the single Facade composed of :
 *   - the strategy provider built from environment variables
 *   - the production DB-backed usage logger
 *
 * `setInstance()` and `reset()` exist for tests : inject a service composed
 * with a NoopLlmUsageLogger and a mocked strategy.
 */
export class LlmGenerationServiceFactory {
  private static cached: LlmGenerationService | null = null;

  public static getInstance(): LlmGenerationService {
    if (this.cached) return this.cached;
    this.cached = new LlmGenerationService(
      LlmStrategyProviderFactory.getInstance(),
      new DbLlmUsageLogger(),
    );
    return this.cached;
  }

  public static setInstance(service: LlmGenerationService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}

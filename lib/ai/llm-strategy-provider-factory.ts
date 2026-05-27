import "server-only";

import type { LlmStrategy, ProviderName } from "./llm-strategy";
import { LlmStrategyProvider } from "./llm-strategy-provider";
import { OpenAiStrategyBuilder } from "./builders/openai-strategy-builder";
import { AnthropicStrategyBuilder } from "./builders/anthropic-strategy-builder";
import { MissingEnvError, UnknownProviderError } from "./errors";

/**
 * Lazy singleton factory that reads environment configuration and assembles
 * an LlmStrategyProvider with all credentialed strategies registered.
 *
 * Selection rule (`LLM_PROVIDER` env var) :
 *   - "openai"     → OpenAI is the default, registered from OPENAI_API_KEY
 *   - "anthropic"  → Anthropic is the default, registered from ANTHROPIC_API_KEY
 *
 * Any provider whose API key is set in env is registered alongside the
 * default — so the call site can request a non-default provider at runtime
 * if needed (e.g. per-org configuration in a future iteration).
 */
export class LlmStrategyProviderFactory {
  private static cached: LlmStrategyProvider | null = null;

  /** Lazy singleton. Subsequent calls return the cached instance. */
  public static getInstance(): LlmStrategyProvider {
    if (this.cached) return this.cached;
    this.cached = this.build();
    return this.cached;
  }

  /** Test hook : inject a mock provider. */
  public static setInstance(provider: LlmStrategyProvider): void {
    this.cached = provider;
  }

  /** Test hook : clear the cache so the next getInstance() re-reads env. */
  public static reset(): void {
    this.cached = null;
  }

  private static build(): LlmStrategyProvider {
    const defaultProviderName = (process.env.LLM_PROVIDER ?? "openai") as ProviderName;

    if (defaultProviderName !== "openai" && defaultProviderName !== "anthropic") {
      throw new UnknownProviderError(defaultProviderName);
    }

    const strategies = new Map<ProviderName, LlmStrategy>();

    // Register every provider whose API key is set. The default provider's
    // key is required ; others are optional.
    if (process.env.OPENAI_API_KEY) {
      strategies.set(
        "openai",
        OpenAiStrategyBuilder.create()
          .withApiKey(process.env.OPENAI_API_KEY)
          .withModel(process.env.OPENAI_MODEL ?? "gpt-5-mini")
          .getInstance(),
      );
    }
    if (process.env.ANTHROPIC_API_KEY) {
      strategies.set(
        "anthropic",
        AnthropicStrategyBuilder.create()
          .withApiKey(process.env.ANTHROPIC_API_KEY)
          .withModel(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5")
          .getInstance(),
      );
    }

    if (!strategies.has(defaultProviderName)) {
      // The default provider's key is missing — that's a hard failure.
      throw new MissingEnvError(
        defaultProviderName === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
      );
    }

    return new LlmStrategyProvider(strategies, defaultProviderName);
  }
}

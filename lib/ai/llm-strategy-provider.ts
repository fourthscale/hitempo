import "server-only";

import type { LlmStrategy, ProviderName } from "./llm-strategy";
import { UnknownProviderError } from "./errors";

/**
 * Owns a registry of LlmStrategy instances and dispenses them on demand.
 *
 * The Provider itself does not know about environment variables or how
 * Strategies are constructed — that's the Factory's job. The Provider
 * receives a pre-built Map and exposes a single dispatch method.
 *
 * This separation is what lets us add per-org or runtime selection later
 * without touching the Strategies or Builders.
 */
export class LlmStrategyProvider {
  private readonly defaultProviderName: ProviderName;

  constructor(
    private readonly strategies: Map<ProviderName, LlmStrategy>,
    defaultProviderName: ProviderName,
  ) {
    if (strategies.size === 0) {
      throw new UnknownProviderError("(no strategies registered)");
    }
    if (!strategies.has(defaultProviderName)) {
      throw new UnknownProviderError(defaultProviderName);
    }
    this.defaultProviderName = defaultProviderName;
  }

  /**
   * Returns the requested Strategy, or the default if no name is given.
   * Throws UnknownProviderError if the name isn't registered.
   */
  public getStrategy(name?: ProviderName): LlmStrategy {
    const target = name ?? this.defaultProviderName;
    const strategy = this.strategies.get(target);
    if (!strategy) throw new UnknownProviderError(target);
    return strategy;
  }

  /** Helper for tests / observability — which providers are registered ? */
  public registeredProviders(): ReadonlyArray<ProviderName> {
    return Array.from(this.strategies.keys());
  }
}

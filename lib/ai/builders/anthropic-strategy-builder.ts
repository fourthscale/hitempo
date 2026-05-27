import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicStrategy } from "../strategies/anthropic-strategy";
import { DefaultPricingCalculator, type PricingCalculator } from "../pricing";
import { BuilderError } from "../errors";

/**
 * Fluent builder for AnthropicStrategy. Mirrors OpenAiStrategyBuilder.
 */
export class AnthropicStrategyBuilder {
  private apiKey?: string;
  private model?: string;
  private pricing?: PricingCalculator;

  public static create(): AnthropicStrategyBuilder {
    return new AnthropicStrategyBuilder();
  }

  public withApiKey(apiKey: string): this {
    this.apiKey = apiKey;
    return this;
  }

  public withModel(model: string): this {
    this.model = model;
    return this;
  }

  public withPricing(pricing: PricingCalculator): this {
    this.pricing = pricing;
    return this;
  }

  public getInstance(): AnthropicStrategy {
    if (!this.apiKey) throw new BuilderError("AnthropicStrategyBuilder", "apiKey");
    if (!this.model)  throw new BuilderError("AnthropicStrategyBuilder", "model");

    const client = new Anthropic({ apiKey: this.apiKey });
    return new AnthropicStrategy(
      client,
      this.model,
      this.pricing ?? new DefaultPricingCalculator(),
    );
  }
}

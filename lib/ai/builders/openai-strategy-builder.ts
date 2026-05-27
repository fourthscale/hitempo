import "server-only";

import OpenAI from "openai";
import { OpenAiStrategy } from "../strategies/openai-strategy";
import { DefaultPricingCalculator, type PricingCalculator } from "../pricing";
import { BuilderError } from "../errors";

/**
 * Fluent builder for OpenAiStrategy.
 *
 * Usage :
 *   const strategy = OpenAiStrategyBuilder.create()
 *     .withApiKey(process.env.OPENAI_API_KEY!)
 *     .withModel("gpt-5-mini")
 *     .getInstance();
 *
 * The `.create()` static entry point keeps the public API a single import
 * (no need to expose the constructor). `.getInstance()` validates required
 * fields and builds the SDK client + Strategy in one go.
 */
export class OpenAiStrategyBuilder {
  private apiKey?: string;
  private model?: string;
  private pricing?: PricingCalculator;

  /** Static entry point — start a new build. */
  public static create(): OpenAiStrategyBuilder {
    return new OpenAiStrategyBuilder();
  }

  public withApiKey(apiKey: string): this {
    this.apiKey = apiKey;
    return this;
  }

  public withModel(model: string): this {
    this.model = model;
    return this;
  }

  /** Optional — defaults to DefaultPricingCalculator if not provided. */
  public withPricing(pricing: PricingCalculator): this {
    this.pricing = pricing;
    return this;
  }

  /**
   * Validates required fields, instantiates the OpenAI SDK client, and
   * produces the Strategy. Throws BuilderError on missing required fields.
   */
  public getInstance(): OpenAiStrategy {
    if (!this.apiKey) throw new BuilderError("OpenAiStrategyBuilder", "apiKey");
    if (!this.model)  throw new BuilderError("OpenAiStrategyBuilder", "model");

    const client = new OpenAI({ apiKey: this.apiKey });
    return new OpenAiStrategy(
      client,
      this.model,
      this.pricing ?? new DefaultPricingCalculator(),
    );
  }
}

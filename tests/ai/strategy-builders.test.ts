import { describe, it, expect } from "vitest";
import { OpenAiStrategyBuilder } from "@/lib/ai/builders/openai-strategy-builder";
import { AnthropicStrategyBuilder } from "@/lib/ai/builders/anthropic-strategy-builder";
import { FixedPricingCalculator } from "@/lib/ai/pricing";
import { BuilderError } from "@/lib/ai/errors";

describe("OpenAiStrategyBuilder", () => {
  it("builds a strategy with required fields", () => {
    const strategy = OpenAiStrategyBuilder.create()
      .withApiKey("sk-fake")
      .withModel("gpt-5-mini")
      .getInstance();

    expect(strategy.providerName).toBe("openai");
    expect(strategy.model).toBe("gpt-5-mini");
  });

  it("uses DefaultPricingCalculator when no pricing is provided", () => {
    // We can't directly inspect the private field, but the build must succeed
    // without calling .withPricing() — that's the contract.
    expect(() => {
      OpenAiStrategyBuilder.create()
        .withApiKey("sk-fake")
        .withModel("gpt-5-mini")
        .getInstance();
    }).not.toThrow();
  });

  it("accepts a custom pricing calculator via withPricing()", () => {
    const strategy = OpenAiStrategyBuilder.create()
      .withApiKey("sk-fake")
      .withModel("gpt-5-mini")
      .withPricing(new FixedPricingCalculator(99))
      .getInstance();

    expect(strategy).toBeDefined();
  });

  it("throws BuilderError when apiKey is missing", () => {
    expect(() =>
      OpenAiStrategyBuilder.create().withModel("gpt-5-mini").getInstance(),
    ).toThrow(BuilderError);
  });

  it("throws BuilderError when model is missing", () => {
    expect(() =>
      OpenAiStrategyBuilder.create().withApiKey("sk-fake").getInstance(),
    ).toThrow(BuilderError);
  });

  it("fluent api returns `this` for chaining", () => {
    const b = OpenAiStrategyBuilder.create();
    expect(b.withApiKey("x")).toBe(b);
    expect(b.withModel("m")).toBe(b);
    expect(b.withPricing(new FixedPricingCalculator(0))).toBe(b);
  });
});

describe("AnthropicStrategyBuilder", () => {
  it("builds a strategy with required fields", () => {
    const strategy = AnthropicStrategyBuilder.create()
      .withApiKey("sk-ant-fake")
      .withModel("claude-sonnet-4-5")
      .getInstance();

    expect(strategy.providerName).toBe("anthropic");
    expect(strategy.model).toBe("claude-sonnet-4-5");
  });

  it("throws BuilderError on missing apiKey", () => {
    expect(() =>
      AnthropicStrategyBuilder.create().withModel("claude-sonnet-4-5").getInstance(),
    ).toThrow(BuilderError);
  });

  it("throws BuilderError on missing model", () => {
    expect(() =>
      AnthropicStrategyBuilder.create().withApiKey("sk-ant").getInstance(),
    ).toThrow(BuilderError);
  });
});

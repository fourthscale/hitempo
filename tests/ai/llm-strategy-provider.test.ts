import { describe, it, expect } from "vitest";
import { LlmStrategyProvider } from "@/lib/ai/llm-strategy-provider";
import type { LlmStrategy, ProviderName } from "@/lib/ai/llm-strategy";
import { UnknownProviderError } from "@/lib/ai/errors";

function makeFakeStrategy(name: ProviderName): LlmStrategy {
  return {
    providerName: name,
    model: `${name}-test-model`,
    generate: async () => ({
      content: "x",
      provider: name,
      model: `${name}-test-model`,
      tokensIn: 1,
      tokensOut: 1,
      costCents: 0,
    }),
  };
}

describe("LlmStrategyProvider", () => {
  it("returns the default strategy when getStrategy() is called without a name", () => {
    const map = new Map<ProviderName, LlmStrategy>([
      ["openai", makeFakeStrategy("openai")],
      ["anthropic", makeFakeStrategy("anthropic")],
    ]);
    const provider = new LlmStrategyProvider(map, "openai");

    expect(provider.getStrategy().providerName).toBe("openai");
  });

  it("returns a specific strategy when name is passed", () => {
    const map = new Map<ProviderName, LlmStrategy>([
      ["openai", makeFakeStrategy("openai")],
      ["anthropic", makeFakeStrategy("anthropic")],
    ]);
    const provider = new LlmStrategyProvider(map, "openai");

    expect(provider.getStrategy("anthropic").providerName).toBe("anthropic");
  });

  it("throws UnknownProviderError when the requested name isn't registered", () => {
    const map = new Map<ProviderName, LlmStrategy>([
      ["openai", makeFakeStrategy("openai")],
    ]);
    const provider = new LlmStrategyProvider(map, "openai");

    expect(() => provider.getStrategy("anthropic")).toThrow(UnknownProviderError);
  });

  it("throws when no strategies are registered at all", () => {
    expect(
      () => new LlmStrategyProvider(new Map(), "openai"),
    ).toThrow(UnknownProviderError);
  });

  it("throws when the default name isn't in the registered set", () => {
    const map = new Map<ProviderName, LlmStrategy>([
      ["openai", makeFakeStrategy("openai")],
    ]);
    expect(() => new LlmStrategyProvider(map, "anthropic")).toThrow(UnknownProviderError);
  });

  it("registeredProviders() exposes the keys", () => {
    const map = new Map<ProviderName, LlmStrategy>([
      ["openai", makeFakeStrategy("openai")],
      ["anthropic", makeFakeStrategy("anthropic")],
    ]);
    const provider = new LlmStrategyProvider(map, "openai");
    expect(provider.registeredProviders().sort()).toEqual(["anthropic", "openai"]);
  });
});

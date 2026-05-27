import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LlmStrategyProviderFactory } from "@/lib/ai/llm-strategy-provider-factory";
import { LlmStrategyProvider } from "@/lib/ai/llm-strategy-provider";
import type { LlmStrategy, ProviderName } from "@/lib/ai/llm-strategy";
import { MissingEnvError, UnknownProviderError } from "@/lib/ai/errors";

function snapshotEnv() {
  return {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  };
}

function restoreEnv(snap: ReturnType<typeof snapshotEnv>) {
  for (const [key, value] of Object.entries(snap)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const ORIGINAL_ENV = snapshotEnv();

describe("LlmStrategyProviderFactory", () => {
  beforeEach(() => {
    LlmStrategyProviderFactory.reset();
    // Clear everything ; tests set what they need.
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    LlmStrategyProviderFactory.reset();
    restoreEnv(ORIGINAL_ENV);
  });

  it("registers OpenAI as default with LLM_PROVIDER=openai", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "gpt-5-mini";

    const provider = LlmStrategyProviderFactory.getInstance();
    expect(provider.getStrategy().providerName).toBe("openai");
    expect(provider.getStrategy().model).toBe("gpt-5-mini");
  });

  it("falls back to LLM_PROVIDER=openai when unset", () => {
    process.env.OPENAI_API_KEY = "sk-test";

    const provider = LlmStrategyProviderFactory.getInstance();
    expect(provider.getStrategy().providerName).toBe("openai");
  });

  it("uses the OPENAI_MODEL default 'gpt-5-mini' when not specified", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const provider = LlmStrategyProviderFactory.getInstance();
    expect(provider.getStrategy().model).toBe("gpt-5-mini");
  });

  it("registers Anthropic as default with LLM_PROVIDER=anthropic", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const provider = LlmStrategyProviderFactory.getInstance();
    expect(provider.getStrategy().providerName).toBe("anthropic");
    expect(provider.getStrategy().model).toBe("claude-sonnet-4-5");
  });

  it("registers both strategies when both keys are set, default = LLM_PROVIDER", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const provider = LlmStrategyProviderFactory.getInstance();
    expect(provider.registeredProviders().sort()).toEqual(["anthropic", "openai"]);
    expect(provider.getStrategy().providerName).toBe("openai");
    expect(provider.getStrategy("anthropic").providerName).toBe("anthropic");
  });

  it("throws MissingEnvError when default provider's API key is missing", () => {
    process.env.LLM_PROVIDER = "openai";
    // OPENAI_API_KEY intentionally unset

    expect(() => LlmStrategyProviderFactory.getInstance()).toThrow(MissingEnvError);
  });

  it("throws UnknownProviderError when LLM_PROVIDER is unrecognized", () => {
    process.env.LLM_PROVIDER = "cohere";
    process.env.OPENAI_API_KEY = "sk-test";

    expect(() => LlmStrategyProviderFactory.getInstance()).toThrow(UnknownProviderError);
  });

  it("singleton — same instance returned across calls", () => {
    process.env.OPENAI_API_KEY = "sk-test";

    const a = LlmStrategyProviderFactory.getInstance();
    const b = LlmStrategyProviderFactory.getInstance();
    expect(a).toBe(b);
  });

  it("reset() forces a fresh build on next getInstance()", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const first = LlmStrategyProviderFactory.getInstance();
    LlmStrategyProviderFactory.reset();
    const second = LlmStrategyProviderFactory.getInstance();
    expect(first).not.toBe(second);
  });

  it("setInstance() injects a custom provider for testing", () => {
    const fake = new LlmStrategyProvider(
      new Map<ProviderName, LlmStrategy>([
        [
          "openai",
          {
            providerName: "openai",
            model: "fake",
            generate: async () => ({
              content: "stub",
              provider: "openai",
              model: "fake",
              tokensIn: 0,
              tokensOut: 0,
              costCents: 0,
            }),
          },
        ],
      ]),
      "openai",
    );
    LlmStrategyProviderFactory.setInstance(fake);

    expect(LlmStrategyProviderFactory.getInstance()).toBe(fake);
  });
});

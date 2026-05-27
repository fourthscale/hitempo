import { describe, it, expect } from "vitest";
import { LlmGenerationService } from "@/lib/ai/llm-generation-service";
import { LlmStrategyProvider } from "@/lib/ai/llm-strategy-provider";
import { NoopLlmUsageLogger } from "@/lib/ai/llm-usage-logger";
import { LlmEmptyResponseError, LlmApiError } from "@/lib/ai/errors";
import type { LlmStrategy, ProviderName, GenerateResult } from "@/lib/ai/llm-strategy";

function makeStrategy(opts: {
  name: ProviderName;
  model: string;
  result?: GenerateResult;
  throws?: Error;
}): LlmStrategy {
  return {
    providerName: opts.name,
    model: opts.model,
    generate: async () => {
      if (opts.throws) throw opts.throws;
      return (
        opts.result ?? {
          content: "default",
          provider: opts.name,
          model: opts.model,
          tokensIn: 10,
          tokensOut: 5,
          costCents: 1,
        }
      );
    },
  };
}

function makeProviderWithStrategy(strategy: LlmStrategy): LlmStrategyProvider {
  return new LlmStrategyProvider(
    new Map<ProviderName, LlmStrategy>([[strategy.providerName, strategy]]),
    strategy.providerName,
  );
}

const baseContext = {
  organizationId: "org-uuid",
  userId: "user-uuid",
  type: "outbound_message" as const,
};

describe("LlmGenerationService — success path", () => {
  it("calls the strategy and logs a success entry with provenance + cost", async () => {
    const strategy = makeStrategy({
      name: "openai",
      model: "gpt-5-mini",
      result: {
        content: "Bonjour Sophie,",
        provider: "openai",
        model: "gpt-5-mini",
        tokensIn: 300,
        tokensOut: 80,
        costCents: 3,
      },
    });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    const { result, usage } = await svc.generate({
      input: { systemPrompt: "s", userPrompt: "u" },
      context: baseContext,
    });

    expect(result.content).toBe("Bonjour Sophie,");
    expect(usage.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(logger.entries).toHaveLength(1);
    const entry = logger.entries[0]!;
    expect(entry.status).toBe("success");
    expect(entry.provider).toBe("openai");
    expect(entry.model).toBe("gpt-5-mini");
    expect(entry.tokensIn).toBe(300);
    expect(entry.tokensOut).toBe(80);
    expect(entry.costCents).toBe(3);
    expect(entry.type).toBe("outbound_message");
    expect(entry.organizationId).toBe("org-uuid");
    expect(entry.userId).toBe("user-uuid");
    expect(entry.errorCode).toBeFalsy();
  });

  it("populates durationMs with a non-negative number", async () => {
    const strategy = makeStrategy({ name: "openai", model: "gpt-5-mini" });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    await svc.generate({
      input: { systemPrompt: "s", userPrompt: "u" },
      context: baseContext,
    });

    expect(logger.entries[0]!.durationMs).not.toBeNull();
    expect(logger.entries[0]!.durationMs!).toBeGreaterThanOrEqual(0);
  });

  it("forwards relatedEntityType / relatedEntityId from context into the log entry", async () => {
    const strategy = makeStrategy({ name: "openai", model: "gpt-5-mini" });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    await svc.generate({
      input: { systemPrompt: "s", userPrompt: "u" },
      context: {
        ...baseContext,
        relatedEntityType: "company",
        relatedEntityId: "co-uuid",
      },
    });

    expect(logger.entries[0]!.relatedEntityType).toBe("company");
    expect(logger.entries[0]!.relatedEntityId).toBe("co-uuid");
  });

  it("uses the named strategy when strategyName is passed", async () => {
    const open = makeStrategy({ name: "openai", model: "gpt-5-mini" });
    const anthr = makeStrategy({
      name: "anthropic",
      model: "claude-sonnet-4-5",
      result: {
        content: "via anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        tokensIn: 5,
        tokensOut: 5,
        costCents: 0,
      },
    });
    const provider = new LlmStrategyProvider(
      new Map<ProviderName, LlmStrategy>([
        ["openai", open],
        ["anthropic", anthr],
      ]),
      "openai",
    );
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(provider, logger);

    const { result } = await svc.generate({
      input: { systemPrompt: "s", userPrompt: "u" },
      context: baseContext,
      strategyName: "anthropic",
    });

    expect(result.content).toBe("via anthropic");
    expect(logger.entries[0]!.provider).toBe("anthropic");
  });
});

describe("LlmGenerationService — error path", () => {
  it("logs an error entry with errorCode and re-throws the original error", async () => {
    const cause = new LlmEmptyResponseError("openai", "gpt-5-mini");
    const strategy = makeStrategy({
      name: "openai",
      model: "gpt-5-mini",
      throws: cause,
    });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    await expect(
      svc.generate({
        input: { systemPrompt: "s", userPrompt: "u" },
        context: baseContext,
      }),
    ).rejects.toBe(cause);

    expect(logger.entries).toHaveLength(1);
    const entry = logger.entries[0]!;
    expect(entry.status).toBe("error");
    expect(entry.errorCode).toBe("EMPTY_RESPONSE");
    expect(entry.tokensIn).toBe(0);
    expect(entry.tokensOut).toBe(0);
    expect(entry.costCents).toBe(0);
    expect(entry.provider).toBe("openai");
    expect(entry.model).toBe("gpt-5-mini");
  });

  it("logs errorCode='UNKNOWN' for non-LlmError exceptions", async () => {
    const strategy = makeStrategy({
      name: "openai",
      model: "gpt-5-mini",
      throws: new TypeError("something else"),
    });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    await expect(
      svc.generate({
        input: { systemPrompt: "s", userPrompt: "u" },
        context: baseContext,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    expect(logger.entries[0]!.errorCode).toBe("UNKNOWN");
  });

  it("logs the LlmApiError code correctly", async () => {
    const strategy = makeStrategy({
      name: "anthropic",
      model: "claude-sonnet-4-5",
      throws: new LlmApiError("anthropic", "claude-sonnet-4-5", "rate limited"),
    });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    await expect(
      svc.generate({
        input: { systemPrompt: "s", userPrompt: "u" },
        context: baseContext,
      }),
    ).rejects.toBeInstanceOf(LlmApiError);

    expect(logger.entries[0]!.errorCode).toBe("API_ERROR");
  });
});

describe("LlmGenerationService.linkUsageToEntity", () => {
  it("delegates to the logger's patchRelatedEntity", async () => {
    const strategy = makeStrategy({ name: "openai", model: "gpt-5-mini" });
    const logger = new NoopLlmUsageLogger();
    const svc = new LlmGenerationService(makeProviderWithStrategy(strategy), logger);

    await svc.linkUsageToEntity("usage-uuid", "message", "msg-uuid");

    expect(logger.patches).toEqual([
      { usageId: "usage-uuid", type: "message", id: "msg-uuid" },
    ]);
  });
});

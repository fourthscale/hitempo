import { describe, it, expect, vi } from "vitest";
import { OpenAiStrategy } from "@/lib/ai/strategies/openai-strategy";
import { FixedPricingCalculator } from "@/lib/ai/pricing";
import { LlmApiError, LlmEmptyResponseError } from "@/lib/ai/errors";

/**
 * Fake client that implements the surface of the OpenAI SDK we depend on.
 * The Strategy receives it via constructor injection — no real HTTP.
 */
function makeFakeClient(
  impl: () => Promise<unknown>,
): { chat: { completions: { create: ReturnType<typeof vi.fn> } } } {
  return {
    chat: {
      completions: {
        create: vi.fn(impl),
      },
    },
  };
}

const PRICING = new FixedPricingCalculator(7);

describe("OpenAiStrategy", () => {
  it("returns parsed content with correct provenance and cost", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "Bonjour Sophie," } }],
      usage: { prompt_tokens: 100, completion_tokens: 30 },
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    const result = await strategy.generate({
      systemPrompt: "You are a helper",
      userPrompt: "Write a hello",
    });

    expect(result.content).toBe("Bonjour Sophie,");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-5-mini");
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(30);
    expect(result.costCents).toBe(7);
    expect(client.chat.completions.create).toHaveBeenCalledOnce();
  });

  it("forwards maxTokens and temperature to the API call for non-reasoning models", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    // Non-reasoning model : temperature IS forwarded. gpt-5 family
    // rejects custom temperature so we drop it silently (see next test).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-4o-mini", PRICING);

    await strategy.generate({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 250,
      temperature: 0.1,
    });

    const calledWith = client.chat.completions.create.mock.calls[0]![0] as {
      max_completion_tokens: number;
      temperature: number;
    };
    expect(calledWith.max_completion_tokens).toBe(250);
    expect(calledWith.temperature).toBe(0.1);
  });

  it("drops temperature on reasoning (gpt-5*) models even when caller set it", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    await strategy.generate({ systemPrompt: "s", userPrompt: "u", temperature: 0.1 });

    const calledWith = client.chat.completions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty("temperature");
  });

  it("omits temperature from the request when not provided (gpt-5 family compatibility)", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    await strategy.generate({ systemPrompt: "s", userPrompt: "u" });

    const calledWith = client.chat.completions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty("temperature");
  });

  it("for gpt-5 family : sets reasoning_effort=low and bumps max_completion_tokens default to 4000", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    await strategy.generate({ systemPrompt: "s", userPrompt: "u" });

    const calledWith = client.chat.completions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(calledWith.reasoning_effort).toBe("low");
    expect(calledWith.max_completion_tokens).toBe(4000);
  });

  it("for non-reasoning models : does NOT set reasoning_effort, default budget = 1000", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-4o-mini", PRICING);

    await strategy.generate({ systemPrompt: "s", userPrompt: "u" });

    const calledWith = client.chat.completions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty("reasoning_effort");
    expect(calledWith.max_completion_tokens).toBe(1000);
  });

  it("caller-provided maxTokens overrides both defaults", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    await strategy.generate({ systemPrompt: "s", userPrompt: "u", maxTokens: 250 });

    const calledWith = client.chat.completions.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(calledWith.max_completion_tokens).toBe(250);
  });

  it("throws LlmEmptyResponseError when content is missing", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    await expect(strategy.generate({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toBeInstanceOf(LlmEmptyResponseError);
  });

  it("wraps SDK exceptions in LlmApiError with the original cause", async () => {
    const cause = new Error("network down");
    const client = makeFakeClient(async () => {
      throw cause;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    await expect(strategy.generate({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toMatchObject({ code: "API_ERROR", cause });
  });

  it("treats missing usage data as 0 tokens (graceful)", async () => {
    const client = makeFakeClient(async () => ({
      choices: [{ message: { content: "hi" } }],
      usage: undefined,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new OpenAiStrategy(client as any, "gpt-5-mini", PRICING);

    const result = await strategy.generate({ systemPrompt: "s", userPrompt: "u" });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
  });
});

describe("OpenAiStrategy — LlmApiError reference", () => {
  it("LlmApiError exported & instantiable", () => {
    const err = new LlmApiError("openai", "gpt-5-mini", "boom");
    expect(err.code).toBe("API_ERROR");
  });
});

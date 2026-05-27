import { describe, it, expect, vi } from "vitest";
import { AnthropicStrategy } from "@/lib/ai/strategies/anthropic-strategy";
import { FixedPricingCalculator } from "@/lib/ai/pricing";
import { LlmApiError, LlmEmptyResponseError } from "@/lib/ai/errors";

function makeFakeClient(
  impl: () => Promise<unknown>,
): { messages: { create: ReturnType<typeof vi.fn> } } {
  return { messages: { create: vi.fn(impl) } };
}

const PRICING = new FixedPricingCalculator(11);

describe("AnthropicStrategy", () => {
  it("returns parsed text content with provenance and cost", async () => {
    const client = makeFakeClient(async () => ({
      content: [{ type: "text", text: "Bonjour" }],
      usage: { input_tokens: 80, output_tokens: 20 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new AnthropicStrategy(client as any, "claude-sonnet-4-5", PRICING);

    const result = await strategy.generate({ systemPrompt: "s", userPrompt: "u" });

    expect(result.content).toBe("Bonjour");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5");
    expect(result.tokensIn).toBe(80);
    expect(result.tokensOut).toBe(20);
    expect(result.costCents).toBe(11);
  });

  it("passes system prompt as top-level field (not as a message)", async () => {
    const client = makeFakeClient(async () => ({
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new AnthropicStrategy(client as any, "claude-sonnet-4-5", PRICING);

    await strategy.generate({ systemPrompt: "the system", userPrompt: "the user" });

    const arg = client.messages.create.mock.calls[0]![0] as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(arg.system).toBe("the system");
    expect(arg.messages).toEqual([{ role: "user", content: "the user" }]);
  });

  it("throws LlmEmptyResponseError when the content block isn't text", async () => {
    const client = makeFakeClient(async () => ({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
      usage: { input_tokens: 1, output_tokens: 0 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new AnthropicStrategy(client as any, "claude-sonnet-4-5", PRICING);

    await expect(strategy.generate({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toBeInstanceOf(LlmEmptyResponseError);
  });

  it("wraps SDK exceptions in LlmApiError", async () => {
    const client = makeFakeClient(async () => {
      throw new Error("rate limited");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strategy = new AnthropicStrategy(client as any, "claude-sonnet-4-5", PRICING);

    await expect(strategy.generate({ systemPrompt: "s", userPrompt: "u" }))
      .rejects.toBeInstanceOf(LlmApiError);
  });
});

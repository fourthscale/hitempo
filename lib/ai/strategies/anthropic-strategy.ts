import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { LlmStrategy, GenerateInput, GenerateResult, ProviderName } from "../llm-strategy";
import type { PricingCalculator } from "../pricing";
import { LlmApiError, LlmEmptyResponseError } from "../errors";

/**
 * Anthropic implementation of the LlmStrategy contract.
 *
 * Mirrors OpenAiStrategy. Different API shape (system prompt is a top-level
 * `system` field rather than a role=system message), but identical contract
 * from the caller's point of view.
 */
export class AnthropicStrategy implements LlmStrategy {
  public readonly providerName: ProviderName = "anthropic";

  constructor(
    private readonly client: Anthropic,
    public readonly model: string,
    private readonly pricing: PricingCalculator,
  ) {}

  public async generate(input: GenerateInput): Promise<GenerateResult> {
    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.userPrompt }],
        max_tokens: input.maxTokens ?? 1000,
        temperature: input.temperature ?? 0.7,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new LlmApiError(this.providerName, this.model, message, { cause });
    }

    // Anthropic returns an array of content blocks ; for text generation we
    // expect a single "text" block. Any other shape is treated as empty.
    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new LlmEmptyResponseError(this.providerName, this.model);
    }

    const tokensIn  = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;

    return {
      content: block.text,
      provider: this.providerName,
      model: this.model,
      tokensIn,
      tokensOut,
      costCents: this.pricing.calculate(this.model, tokensIn, tokensOut),
    };
  }
}

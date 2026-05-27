import "server-only";

import type OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { LlmStrategy, GenerateInput, GenerateResult, ProviderName } from "../llm-strategy";
import type { PricingCalculator } from "../pricing";
import { LlmApiError, LlmEmptyResponseError } from "../errors";

/**
 * OpenAI implementation of the LlmStrategy contract.
 *
 * Pure strategy : the class fully encapsulates how to talk to OpenAI's
 * Chat Completions API and how to compute its cost. Construction is the
 * Builder's job (see `OpenAiStrategyBuilder`) — never instantiate this
 * directly in application code.
 */
export class OpenAiStrategy implements LlmStrategy {
  public readonly providerName: ProviderName = "openai";

  /**
   * Dependency injection : the client, model name, and pricing are all
   * provided by the Builder. The Strategy has no static state and no
   * implicit dependencies on environment or globals.
   */
  constructor(
    private readonly client: OpenAI,
    public readonly model: string,
    private readonly pricing: PricingCalculator,
  ) {}

  public async generate(input: GenerateInput): Promise<GenerateResult> {
    // GPT-5 family is a reasoning model : it consumes part of
    // `max_completion_tokens` on internal reasoning. We need both a higher
    // default budget AND a low reasoning effort to leave room for the actual
    // copywriting output. Detection by model-name prefix is brittle, but
    // OpenAI keeps the "gpt-5" naming stable across the family (gpt-5,
    // gpt-5-mini, gpt-5-nano…) — and it's the only naming hint we have.
    const isReasoningModel = this.model.startsWith("gpt-5");

    let response;
    try {
      // We only forward `temperature` when the caller explicitly set it ;
      // reasoning models reject any non-default value.
      const request: ChatCompletionCreateParamsNonStreaming = {
        model: this.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user",   content: input.userPrompt },
        ],
        max_completion_tokens: input.maxTokens ?? (isReasoningModel ? 4000 : 1000),
      };
      if (input.temperature !== undefined) {
        request.temperature = input.temperature;
      }
      if (isReasoningModel) {
        // Copywriting needs minimal reasoning ; keeps the output budget intact.
        request.reasoning_effort = "low";
      }
      response = await this.client.chat.completions.create(request);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new LlmApiError(this.providerName, this.model, message, { cause });
    }

    const choice = response.choices[0];
    const content = choice?.message?.content;
    if (!content) {
      throw new LlmEmptyResponseError(this.providerName, this.model);
    }

    const tokensIn  = response.usage?.prompt_tokens     ?? 0;
    const tokensOut = response.usage?.completion_tokens ?? 0;

    return {
      content,
      provider: this.providerName,
      model: this.model,
      tokensIn,
      tokensOut,
      costCents: this.pricing.calculate(this.model, tokensIn, tokensOut),
    };
  }
}

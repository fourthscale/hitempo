/**
 * Contract every LLM-backed service in hitempo must implement.
 *
 * One concrete class per provider (OpenAiStrategy, AnthropicStrategy, ...).
 * Built via dedicated Builders, registered into an LlmStrategyProvider,
 * which itself is produced by an LlmStrategyProviderFactory.
 *
 * See docs/features/07-ai-message-generation.md § "LLM architecture".
 */

export type ProviderName = "openai" | "anthropic";

/**
 * What we send to any LLM. Provider-agnostic — each Strategy translates
 * this into the provider-specific request format (Chat Completions for
 * OpenAI, Messages for Anthropic, etc.).
 */
export type GenerateInput = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
};

/**
 * What every Strategy returns, regardless of provider. Provenance fields
 * (provider/model/tokens/cost) are populated by the Strategy itself so
 * the orchestrating Facade can persist them in `llm_usage` without
 * knowing which provider was used.
 */
export type GenerateResult = {
  content: string;
  provider: ProviderName;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
};

export interface LlmStrategy {
  readonly providerName: ProviderName;
  readonly model: string;
  generate(input: GenerateInput): Promise<GenerateResult>;
}

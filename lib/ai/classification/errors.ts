/**
 * Typed errors for the intent classification subsystem. Extending LlmError
 * means they're captured by the same `llm_usage.error_code` path as the
 * outbound message generation errors.
 */

import { LlmError } from "@/lib/ai/errors";

/** The LLM returned content we couldn't parse into a valid classification. */
export class ClassificationParseError extends LlmError {
  public readonly code = "CLASSIFICATION_PARSE_ERROR";

  constructor(
    public readonly raw: string,
    public readonly reason: string,
  ) {
    super(`Failed to parse classification response: ${reason}`);
  }
}

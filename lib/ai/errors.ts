/**
 * Typed error hierarchy for the LLM subsystem.
 *
 * Every error thrown by strategies, builders, providers, or the Facade is a
 * subclass of LlmError with a stable `code`. Callers can switch on `code`
 * without resorting to string matching, and the Facade's error logger
 * captures the code into `llm_usage.error_code`.
 */

import type { ProviderName } from "./llm-strategy";

export abstract class LlmError extends Error {
  /** Stable, machine-readable error code for logging and dispatch. */
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** The provider returned a response with no usable content. */
export class LlmEmptyResponseError extends LlmError {
  public readonly code = "EMPTY_RESPONSE";

  constructor(
    public readonly provider: ProviderName,
    public readonly model: string,
  ) {
    super(`${provider}/${model} returned no content`);
  }
}

/** The provider API call failed (network, 5xx, auth, etc.). */
export class LlmApiError extends LlmError {
  public readonly code = "API_ERROR";

  constructor(
    public readonly provider: ProviderName,
    public readonly model: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${provider}/${model} API error: ${message}`, options);
  }
}

/** A Builder was asked to build before all required fields were set. */
export class BuilderError extends LlmError {
  public readonly code = "BUILDER_INVALID";

  constructor(
    public readonly builderName: string,
    public readonly missingField: string,
  ) {
    super(`${builderName}: required field "${missingField}" is missing`);
  }
}

/** A required environment variable is not set. */
export class MissingEnvError extends LlmError {
  public readonly code = "MISSING_ENV";

  constructor(public readonly envKey: string) {
    super(`Missing required environment variable: ${envKey}`);
  }
}

/** The active LLM_PROVIDER (or an explicitly requested name) is not registered. */
export class UnknownProviderError extends LlmError {
  public readonly code = "UNKNOWN_PROVIDER";

  constructor(public readonly providerName: string) {
    super(`Unknown or unregistered LLM provider: ${providerName}`);
  }
}

/**
 * The active organization has no brand brief configured for the target locale.
 * Surfaced by `generateMessageAction` to push the user toward `/settings/brand`.
 */
export class BrandBriefMissingError extends LlmError {
  public readonly code = "BRAND_BRIEF_MISSING";

  constructor(public readonly locale: string) {
    super(`Brand brief is not configured for locale "${locale}"`);
  }
}

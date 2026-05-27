import { describe, it, expect } from "vitest";
import {
  LlmError,
  LlmEmptyResponseError,
  LlmApiError,
  BuilderError,
  MissingEnvError,
  UnknownProviderError,
} from "@/lib/ai/errors";

describe("LLM error hierarchy", () => {
  it("LlmEmptyResponseError has stable code and inherits LlmError + Error", () => {
    const err = new LlmEmptyResponseError("openai", "gpt-5-mini");
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("EMPTY_RESPONSE");
    expect(err.provider).toBe("openai");
    expect(err.model).toBe("gpt-5-mini");
    expect(err.message).toContain("gpt-5-mini");
  });

  it("LlmApiError captures provider, model, message, and cause", () => {
    const cause = new Error("upstream failure");
    const err = new LlmApiError("anthropic", "claude-sonnet-4-5", "rate limited", { cause });
    expect(err.code).toBe("API_ERROR");
    expect(err.provider).toBe("anthropic");
    expect(err.cause).toBe(cause);
    expect(err.message).toContain("rate limited");
  });

  it("BuilderError captures builder name and missing field", () => {
    const err = new BuilderError("OpenAiStrategyBuilder", "apiKey");
    expect(err.code).toBe("BUILDER_INVALID");
    expect(err.builderName).toBe("OpenAiStrategyBuilder");
    expect(err.missingField).toBe("apiKey");
  });

  it("MissingEnvError exposes the env key", () => {
    const err = new MissingEnvError("OPENAI_API_KEY");
    expect(err.code).toBe("MISSING_ENV");
    expect(err.envKey).toBe("OPENAI_API_KEY");
  });

  it("UnknownProviderError exposes the unknown name", () => {
    const err = new UnknownProviderError("cohere");
    expect(err.code).toBe("UNKNOWN_PROVIDER");
    expect(err.providerName).toBe("cohere");
  });

  it("each error class name matches the class itself (for stack traces)", () => {
    expect(new LlmEmptyResponseError("openai", "x").name).toBe("LlmEmptyResponseError");
    expect(new BuilderError("X", "y").name).toBe("BuilderError");
    expect(new UnknownProviderError("z").name).toBe("UnknownProviderError");
  });
});

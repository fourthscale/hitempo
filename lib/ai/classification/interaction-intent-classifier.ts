import "server-only";

import type { LlmGenerationService } from "@/lib/ai/llm-generation-service";
import { ClassificationParseError } from "./errors";
import { parseClassificationResponse, type ClassificationOutput } from "./parse-response";
import {
  buildIntentClassificationPrompt,
  type IntentClassificationInput,
} from "./prompt-builder";
import { tierForConfidence, type ConfidenceTier } from "./thresholds";
import { intentToOutcome, type IntentOutcome } from "./intent-labels";

/**
 * Facade that turns a raw inbound reply snippet into a structured intent
 * classification, persisted-cost-tracked through the same LlmGenerationService
 * the rest of the app uses for outbound generation.
 *
 * Single responsibility : prompt → LLM call → parse → derive (tier, outcome).
 * It does NOT mutate the DB itself — the calling Inngest function persists
 * the result and decides whether to apply `interaction.outcome`. Keeping
 * persistence outside this class lets us unit-test it with a single mocked
 * `LlmGenerationService` and no DB stub.
 */
export type ClassifyResult = {
  /** Validated classification (label, confidence, reasoning). */
  output: ClassificationOutput;
  /** Confidence tier — caller uses this to gate outcome auto-application. */
  tier: ConfidenceTier;
  /**
   * The `interaction_outcome` enum value the caller should apply IFF the
   * tier is "auto". `null` for neutral / unknown / tier < auto.
   */
  outcome: IntentOutcome | null;
};

export class InteractionIntentClassifier {
  constructor(private readonly llm: LlmGenerationService) {}

  /**
   * Classify a single reply. Throws ClassificationParseError on unparseable
   * LLM output ; the Inngest function catches it and stores
   * `label="unknown", confidence=0` so we don't retry indefinitely.
   */
  public async classify(params: {
    input: IntentClassificationInput;
    organizationId: string;
    userId?: string | null;
    interactionId: string;
  }): Promise<ClassifyResult> {
    const generateInput = buildIntentClassificationPrompt(params.input);

    const { result } = await this.llm.generate({
      input: generateInput,
      context: {
        organizationId: params.organizationId,
        userId: params.userId ?? null,
        type: "interaction_summary", // re-use the closest existing usage_type
        relatedEntityType: "interaction",
        relatedEntityId: params.interactionId,
      },
    });

    const parsed = parseClassificationResponse(result.content);
    if (!parsed) {
      throw new ClassificationParseError(result.content, "invalid JSON or schema");
    }

    const tier = tierForConfidence(parsed.confidence);
    const outcome = tier === "auto" ? intentToOutcome(parsed.label) : null;

    return { output: parsed, tier, outcome };
  }
}

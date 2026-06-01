import "server-only";

import { LlmGenerationServiceFactory } from "@/lib/ai/llm-generation-service-factory";
import { InteractionIntentClassifier } from "./interaction-intent-classifier";

/**
 * Lazy singleton factory for the InteractionIntentClassifier.
 *
 * Same pattern as LlmGenerationServiceFactory : composed once at first
 * call, reusable across Inngest invocations within a single warm process.
 * Tests inject via `setInstance()` and reset between cases with `reset()`.
 */
export class InteractionIntentClassifierFactory {
  private static cached: InteractionIntentClassifier | null = null;

  public static getInstance(): InteractionIntentClassifier {
    if (this.cached) return this.cached;
    this.cached = new InteractionIntentClassifier(
      LlmGenerationServiceFactory.getInstance(),
    );
    return this.cached;
  }

  public static setInstance(classifier: InteractionIntentClassifier): void {
    this.cached = classifier;
  }

  public static reset(): void {
    this.cached = null;
  }
}

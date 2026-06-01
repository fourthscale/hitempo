import "server-only";

import { ClassificationOrchestrator } from "./classification-orchestrator";
import { InteractionIntentClassifierFactory } from "./interaction-intent-classifier-factory";

/**
 * Lazy singleton factory matching the project's "<X>Factory.getInstance()"
 * convention. Same test hooks (setInstance / reset) as the other factories.
 */
export class ClassificationOrchestratorFactory {
  private static cached: ClassificationOrchestrator | null = null;

  public static getInstance(): ClassificationOrchestrator {
    if (this.cached) return this.cached;
    this.cached = new ClassificationOrchestrator(
      InteractionIntentClassifierFactory.getInstance(),
    );
    return this.cached;
  }

  public static setInstance(orch: ClassificationOrchestrator): void {
    this.cached = orch;
  }

  public static reset(): void {
    this.cached = null;
  }
}

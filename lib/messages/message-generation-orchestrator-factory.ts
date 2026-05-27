import "server-only";

import { LlmGenerationServiceFactory } from "@/lib/ai/llm-generation-service-factory";
import { MessageGenerationOrchestrator } from "./message-generation-orchestrator";

/**
 * Lazy singleton factory for the message generation orchestrator.
 *
 * Mirrors `LlmGenerationServiceFactory` : actions call `getInstance()` to
 * obtain a fully-composed orchestrator. `setInstance()` / `reset()` exist
 * for tests so a mocked `LlmGenerationService` can be injected.
 */
export class MessageGenerationOrchestratorFactory {
  private static cached: MessageGenerationOrchestrator | null = null;

  public static getInstance(): MessageGenerationOrchestrator {
    if (this.cached) return this.cached;
    this.cached = new MessageGenerationOrchestrator(
      LlmGenerationServiceFactory.getInstance(),
    );
    return this.cached;
  }

  public static setInstance(orchestrator: MessageGenerationOrchestrator): void {
    this.cached = orchestrator;
  }

  public static reset(): void {
    this.cached = null;
  }
}

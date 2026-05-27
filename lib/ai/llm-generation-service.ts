import "server-only";

import type { LlmStrategyProvider } from "./llm-strategy-provider";
import type { LlmUsageLogger, LlmUsageType, LlmUsageRecord } from "./llm-usage-logger";
import type { GenerateInput, GenerateResult, ProviderName } from "./llm-strategy";
import { LlmError } from "./errors";

/**
 * Facade — the only entry point application code uses to call an LLM.
 *
 * Composes `LlmStrategyProvider` (which strategy to use) and `LlmUsageLogger`
 * (where to record the call), so every server action that needs AI gets :
 *
 *   - automatic logging (success AND failure, including latency)
 *   - automatic cost capture in cents
 *   - guaranteed audit trail in the `llm_usage` table
 *
 * No code outside this class should ever call `strategy.generate()` directly
 * — that would skip logging and break the cost-visibility contract.
 */
export class LlmGenerationService {
  constructor(
    private readonly strategyProvider: LlmStrategyProvider,
    private readonly usageLogger: LlmUsageLogger,
  ) {}

  /**
   * Calls the active (or named) strategy, logs the call, returns the result
   * along with the usage row id so callers can FK their domain record into it.
   *
   * On error, also logs an `error` row with tokens=0 and the error code,
   * then re-throws the original exception unchanged.
   */
  public async generate(params: {
    input: GenerateInput;
    context: LlmCallContext;
    strategyName?: ProviderName;
  }): Promise<{ result: GenerateResult; usage: LlmUsageRecord }> {
    const strategy = this.strategyProvider.getStrategy(params.strategyName);
    const start = Date.now();

    try {
      const result = await strategy.generate(params.input);
      const usage = await this.usageLogger.log({
        organizationId: params.context.organizationId,
        userId: params.context.userId ?? null,
        type: params.context.type,
        provider: result.provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costCents: result.costCents,
        durationMs: Date.now() - start,
        relatedEntityType: params.context.relatedEntityType ?? null,
        relatedEntityId: params.context.relatedEntityId ?? null,
        status: "success",
      });

      return { result, usage };
    } catch (error) {
      // Log the failed call so we have visibility on cost-of-failure and
      // can diagnose provider outages. We use 0 tokens because we don't
      // have usage data on error.
      const errorCode = error instanceof LlmError ? error.code : "UNKNOWN";
      await this.usageLogger.log({
        organizationId: params.context.organizationId,
        userId: params.context.userId ?? null,
        type: params.context.type,
        provider: strategy.providerName,
        model: strategy.model,
        tokensIn: 0,
        tokensOut: 0,
        costCents: 0,
        durationMs: Date.now() - start,
        relatedEntityType: params.context.relatedEntityType ?? null,
        relatedEntityId: params.context.relatedEntityId ?? null,
        status: "error",
        errorCode,
      });

      throw error;
    }
  }

  /**
   * Patches the polymorphic backref on a previously-logged row.
   * Used when the caller couldn't know the related entity ID at log time
   * (e.g. message insert happens after the LLM call, then we patch back).
   */
  public async linkUsageToEntity(
    usageId: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    await this.usageLogger.patchRelatedEntity(usageId, entityType, entityId);
  }
}

/**
 * Context attached to every LLM call : tenant, user, what the call is for,
 * and optionally which entity it's about. Used to populate `llm_usage`.
 */
export type LlmCallContext = {
  organizationId: string;
  userId?: string | null;
  type: LlmUsageType;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { ConditionalSplitActionConfig } from "../types";

/**
 * `conditional_split` — if/else router. Evaluates the YES condition (a
 * composite AND/OR group) via the engine-injected `evaluatePredicate` and
 * routes `yes` / `no`. The ELSE side is implicit (everyone who doesn't match).
 */
export class ConditionalSplitStepExecutor implements SequenceStepExecutor {
  readonly actionType = "conditional_split" as const;

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as ConditionalSplitActionConfig;
    const matched = ctx.evaluatePredicate({
      type: "composite",
      config: config.condition as unknown as Record<string, unknown>,
    });
    return { navigateTo: matched ? "yes" : "no" };
  }
}

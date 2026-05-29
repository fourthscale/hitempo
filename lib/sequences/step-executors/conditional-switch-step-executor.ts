import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { ConditionalSwitchActionConfig } from "../types";

/**
 * `conditional_switch` — ordered if/elif/else ladder. Evaluates each branch's
 * composite condition in order ; the first match routes to that branch
 * (`navigateTo = "<index>"`, looked up in next_step_ids.cases). No match →
 * `default` (the implicit else).
 */
export class ConditionalSwitchStepExecutor implements SequenceStepExecutor {
  readonly actionType = "conditional_switch" as const;

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as ConditionalSwitchActionConfig;
    const branches = config.branches ?? [];
    for (let i = 0; i < branches.length; i++) {
      const matched = ctx.evaluatePredicate({
        type: "composite",
        config: branches[i]!.condition as unknown as Record<string, unknown>,
      });
      if (matched) return { navigateTo: String(i) };
    }
    return { navigateTo: "default" };
  }
}

import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { WaitDelayActionConfig, SequenceDelayUnit } from "../types";
import { InvalidActionConfigError } from "../sequence-errors";

const UNIT_MS: Record<SequenceDelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/**
 * `wait_delay` — does no action ; advances to the next step but schedules it
 * `duration_value × duration_unit` into the future. The engine applies the
 * returned `delayMs` to the next step's `next_due_at`.
 *
 * (The step's `condition` is evaluated by the engine BEFORE this runs — a
 * false condition skips the wait and advances immediately, so this executor
 * only ever runs when the wait should actually happen.)
 */
export class WaitDelayStepExecutor implements SequenceStepExecutor {
  readonly actionType = "wait_delay" as const;

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as WaitDelayActionConfig;
    const unitMs = UNIT_MS[config.durationUnit];
    if (unitMs == null || !Number.isFinite(config.durationValue) || config.durationValue < 0) {
      throw new InvalidActionConfigError(
        "wait_delay",
        `duration_value=${config.durationValue} duration_unit=${config.durationUnit}`,
      );
    }
    return {
      navigateTo: "default",
      delayMs: Math.round(config.durationValue * unitMs),
    };
  }
}

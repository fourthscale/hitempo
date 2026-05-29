import type { SequenceStepExecutor, StepExecutionResult } from "../step-executor";

/**
 * `merge` — a passthrough join node where branches converge. It performs no
 * action and carries no config ; the engine simply advances to its `default`
 * continuation (or ends if unset). It exists so several branch ends can point
 * at one shared downstream path in the editor.
 */
export class MergeStepExecutor implements SequenceStepExecutor {
  readonly actionType = "merge" as const;

  async execute(): Promise<StepExecutionResult> {
    return { navigateTo: "default" };
  }
}

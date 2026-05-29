import type { SequenceStepActionType } from "./types";
import type { SequenceStepExecutor } from "./step-executor";
import { UnknownActionTypeError } from "./sequence-errors";
import { SendMessageStepExecutor } from "./step-executors/send-message-step-executor";
import { PhoneCallStepExecutor } from "./step-executors/phone-call-step-executor";
import { WaitDelayStepExecutor } from "./step-executors/wait-delay-step-executor";
import { UpdateContactStepExecutor } from "./step-executors/update-contact-step-executor";
import { ConditionalSplitStepExecutor } from "./step-executors/conditional-split-step-executor";
import { ConditionalSwitchStepExecutor } from "./step-executors/conditional-switch-step-executor";
import { EnrollInSequenceStepExecutor } from "./step-executors/enroll-in-sequence-step-executor";
import { MergeStepExecutor } from "./step-executors/merge-step-executor";

/**
 * Static registry of step executors keyed by action type (Strategy + Factory).
 * New executors register here with no engine change. Executors are stateless,
 * so a single shared instance per type is reused.
 */
export class SequenceStepExecutorFactory {
  private static readonly registry: Map<SequenceStepActionType, SequenceStepExecutor> = new Map(
    (
      [
        new SendMessageStepExecutor("send_email"),
        new SendMessageStepExecutor("send_linkedin"),
        new PhoneCallStepExecutor(),
        new WaitDelayStepExecutor(),
        new UpdateContactStepExecutor(),
        new ConditionalSplitStepExecutor(),
        new ConditionalSwitchStepExecutor(),
        new EnrollInSequenceStepExecutor(),
        new MergeStepExecutor(),
      ] satisfies SequenceStepExecutor[]
    ).map((executor) => [executor.actionType, executor]),
  );

  static forActionType(actionType: SequenceStepActionType): SequenceStepExecutor {
    const executor = SequenceStepExecutorFactory.registry.get(actionType);
    if (!executor) {
      throw new UnknownActionTypeError(actionType);
    }
    return executor;
  }

  static isKnownActionType(actionType: string): actionType is SequenceStepActionType {
    return SequenceStepExecutorFactory.registry.has(actionType as SequenceStepActionType);
  }

  static knownActionTypes(): SequenceStepActionType[] {
    return [...SequenceStepExecutorFactory.registry.keys()];
  }
}

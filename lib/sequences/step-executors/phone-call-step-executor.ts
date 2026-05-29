import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { PhoneCallActionConfig } from "../types";
import { resolveLocalizedString } from "../locale-resolver";
import { localeCtx, resolveAssignee } from "./shared";

/**
 * `phone_call` — creates a manual call task (no message). The rep calls and
 * logs the outcome ; conditions on later steps can branch on `if_no_answer`.
 */
export class PhoneCallStepExecutor implements SequenceStepExecutor {
  readonly actionType = "phone_call" as const;

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as PhoneCallActionConfig;
    const lc = localeCtx(ctx);
    const { taskId } = await ctx.services.createTask({
      organizationId: ctx.enrolment.organizationId,
      companyId: ctx.enrolment.companyId,
      contactId: ctx.enrolment.contactId,
      assigneeId: resolveAssignee(ctx, config.assignment),
      sequenceEnrolmentId: ctx.enrolment.id,
      type: "phone",
      title: resolveLocalizedString(config.titleTemplate, lc),
      description: config.description ? resolveLocalizedString(config.description, lc) : null,
    });
    return { taskId, navigateTo: "default" };
  }
}

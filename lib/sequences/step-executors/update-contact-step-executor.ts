import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { UpdateContactActionConfig } from "../types";

/**
 * `update_contact` — applies a small, safe patch to the contact (status,
 * relationship type) then advances. No task created. Useful for "mark as
 * nurturing after the sequence ends" style automations.
 */
export class UpdateContactStepExecutor implements SequenceStepExecutor {
  readonly actionType = "update_contact" as const;

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as UpdateContactActionConfig;
    await ctx.services.updateContact({
      organizationId: ctx.enrolment.organizationId,
      contactId: ctx.enrolment.contactId,
      patch: {
        status: config.setStatus || undefined,
        role: config.setRole || undefined,
      },
    });
    return { navigateTo: "default" };
  }
}

import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { EnrollInSequenceActionConfig } from "../types";
import { InvalidActionConfigError } from "../sequence-errors";

/**
 * `enroll_in_sequence` — cascade. Enrols the contact into another sequence
 * (eligibility re-checked by the service) and ends the current enrolment with
 * end_reason='cascaded'. The cascade is attempted regardless of whether the
 * new enrolment is accepted ; if eligibility rejects it the current enrolment
 * still ends cascaded (the rep's intent was to hand off).
 */
export class EnrollInSequenceStepExecutor implements SequenceStepExecutor {
  readonly actionType = "enroll_in_sequence" as const;

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as EnrollInSequenceActionConfig;
    if (!config.targetSequenceId) {
      throw new InvalidActionConfigError("enroll_in_sequence", "missing target_sequence_id");
    }

    const result = await ctx.services.cascadeEnrol({
      targetSequenceId: config.targetSequenceId,
      startAtStep: config.startAtStep ?? 0,
      organizationId: ctx.enrolment.organizationId,
      companyId: ctx.enrolment.companyId,
      contactId: ctx.enrolment.contactId,
      assigneeId: ctx.enrolment.assigneeId,
    });

    return {
      markEnded: "cascaded",
      notes: result.enrolmentId
        ? `cascaded into ${config.targetSequenceId} (enrolment ${result.enrolmentId})`
        : `cascade target ${config.targetSequenceId} skipped: ${result.skippedReason ?? "not eligible"}`,
    };
  }
}

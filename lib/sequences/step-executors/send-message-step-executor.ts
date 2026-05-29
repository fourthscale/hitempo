import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { SendMessageActionConfig } from "../types";
import { resolveLocalizedString } from "../locale-resolver";
import { localeCtx, narrowMessageLocale, resolveAssignee } from "./shared";

/**
 * `send_email` / `send_linkedin` — creates an outreach task on the right
 * channel. Two message modes :
 *   - `ai`      : draft generated when the rep opens the task (deferred — see
 *                 EngineExecutorServices). The task carries the AI inputs.
 *   - `defined` : the rep gets the pre-written subject/body (resolved to the
 *                 contact's locale) directly in the task description.
 *
 * One class, two registrations (action type injected) so the channel mapping
 * stays in one place.
 */
export class SendMessageStepExecutor implements SequenceStepExecutor {
  readonly actionType: "send_email" | "send_linkedin";

  constructor(actionType: "send_email" | "send_linkedin") {
    this.actionType = actionType;
  }

  async execute(ctx: StepExecutionContext): Promise<StepExecutionResult> {
    const config = ctx.step.actionConfig as SendMessageActionConfig;
    const lc = localeCtx(ctx);
    const title = resolveLocalizedString(config.titleTemplate, lc);
    const taskType = this.actionType === "send_email" ? "email" : "linkedin";

    let description: string | null = null;
    if (config.mode === "defined") {
      const subject = config.subject ? resolveLocalizedString(config.subject, lc) : "";
      const body = config.body ? resolveLocalizedString(config.body, lc) : "";
      description = [subject ? `${subject}` : "", body].filter(Boolean).join("\n\n") || null;
    }

    const { taskId } = await ctx.services.createTask({
      organizationId: ctx.enrolment.organizationId,
      companyId: ctx.enrolment.companyId,
      contactId: ctx.enrolment.contactId,
      assigneeId: resolveAssignee(ctx, config.assignment),
      sequenceEnrolmentId: ctx.enrolment.id,
      type: taskType,
      title,
      description,
    });

    if (config.mode === "ai") {
      const orientation = config.orientation
        ? resolveLocalizedString(config.orientation, lc)
        : null;
      await ctx.services.generateDraftForTask({
        organizationId: ctx.enrolment.organizationId,
        companyId: ctx.enrolment.companyId,
        contactId: ctx.enrolment.contactId,
        taskId,
        userId: ctx.userId,
        channel: config.channel,
        intent: config.intent,
        includeSignal: config.includeSignal ?? false,
        orientation,
        locale: narrowMessageLocale(ctx.contact.preferredLanguage),
      });
    }

    return { taskId, navigateTo: "default" };
  }
}

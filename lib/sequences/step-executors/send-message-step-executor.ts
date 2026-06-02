import type { SequenceStepExecutor, StepExecutionContext, StepExecutionResult } from "../step-executor";
import type { SendMessageActionConfig } from "../types";
import { resolveLocalizedString } from "../locale-resolver";
import { localeCtx, narrowMessageLocale, resolveAssignee } from "./shared";
import { renderTemplate, type TemplateFacts } from "@/lib/messages/template-render";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";

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
      // Sprint 12 — defined-mode templates may carry {{contact.*}},
      // {{company.*}}, {{sender.*}} placeholders. Build the facts
      // snapshot once, render subject + body against it.
      const facts = await buildTemplateFacts(ctx);
      const subjectRaw = config.subject ? resolveLocalizedString(config.subject, lc) : "";
      const bodyRaw    = config.body    ? resolveLocalizedString(config.body, lc)    : "";
      const subject = renderTemplate(subjectRaw, facts).text;
      const body    = renderTemplate(bodyRaw, facts).text;
      description = [subject ? `${subject}` : "", body].filter(Boolean).join("\n\n") || null;
    }

    const { taskId, scheduledFor } = await ctx.services.createTask({
      organizationId: ctx.enrolment.organizationId,
      companyId: ctx.enrolment.companyId,
      contactId: ctx.enrolment.contactId,
      assigneeId: resolveAssignee(ctx, config.assignment),
      sequenceEnrolmentId: ctx.enrolment.id,
      type: taskType,
      title,
      description,
      scheduling: config.scheduling,
    });

    // Sprint 12 phase 4 — when the step's assignment.actor is "agent" AND
    // the channel is email (the only thing we can auto-send), hand the
    // task off to the agent auto-execute pipeline. Otherwise the task
    // lands in the human queue normally.
    if (config.assignment?.actor === "agent" && this.actionType === "send_email") {
      await ctx.services.scheduleAgentAutoExecute({
        organizationId: ctx.enrolment.organizationId,
        taskId,
        scheduledFor,
      });
    }

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

    // Block the sequence on the rep actually sending the email — the
    // `sequences/task.completed` event resumes advancement when they close
    // the task. Without this the cron tick would push past the unfinished
    // outreach and stack a second/third email on the contact. Optional
    // `awaitTaskTimeoutDays` on the step config caps the wait if the rep
    // forgets the task entirely (omit = wait forever, the default).
    return {
      taskId,
      navigateTo: "default",
      awaitTaskCompletion: true,
      awaitTaskTimeoutMs:
        config.awaitTaskTimeoutDays != null
          ? config.awaitTaskTimeoutDays * 24 * 60 * 60 * 1000
          : undefined,
    };
  }
}

/**
 * Sprint 12 — assembles the `TemplateFacts` snapshot for the renderer.
 * Sender name is best-effort : if the assignee can't be resolved (no
 * userId, lookup failure), `{{sender.*}}` falls back to the template's
 * `|| 'fallback'` clause or stays empty.
 */
async function buildTemplateFacts(ctx: StepExecutionContext): Promise<TemplateFacts> {
  const sender = ctx.userId ? await ctx.services.getSenderName(ctx.userId) : null;
  const senderFull = sender
    ? [sender.firstName, sender.lastName].filter(Boolean).join(" ").trim()
    : "";
  return {
    "contact.firstName": ctx.contact.firstName ?? null,
    "contact.lastName":  ctx.contact.lastName ?? null,
    "contact.fullName":  resolveContactDisplayName({
      kind: ctx.contact.kind,
      firstName: ctx.contact.firstName,
      lastName: ctx.contact.lastName,
      // resolveContactDisplayName tolerates missing email/jobTitle for the
      // "fullName" purpose ; the helper falls back to "—" only when it has
      // no other angle, which is acceptable in a template substitution.
    } as Parameters<typeof resolveContactDisplayName>[0]),
    "contact.jobTitle":  ctx.contact.jobTitle ?? null,
    "company.name":       ctx.company.name ?? null,
    "company.signalType": ctx.company.signalType ?? null,
    "sender.firstName": sender?.firstName ?? null,
    "sender.lastName":  sender?.lastName ?? null,
    "sender.fullName":  senderFull || null,
  };
}

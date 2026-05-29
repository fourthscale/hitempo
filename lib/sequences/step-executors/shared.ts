import type { StepExecutionContext } from "../step-executor";
import type { TaskAssignment } from "../types";

/**
 * The locale-chain context every executor passes to `resolveLocalizedString`.
 * Extracted from the step execution context.
 */
export function localeCtx(ctx: StepExecutionContext) {
  return {
    contact: { preferredLanguage: ctx.contact.preferredLanguage },
    company: { primaryLocale: ctx.company.primaryLocale },
    organization: { defaultLocale: ctx.organization.defaultLocale },
  };
}

/**
 * The message generator only handles 'fr' | 'en'. Narrow the contact's free-
 * text preferred language to one of those, defaulting to 'fr'.
 */
export function narrowMessageLocale(preferred: string): "fr" | "en" {
  return preferred.toLowerCase().startsWith("en") ? "en" : "fr";
}

/**
 * Resolve the user a task should be assigned to from the step's assignment
 * config. `owner` (the default) = contact owner → company owner → the enroller ;
 * `specific` = the chosen member, falling back to the enroller. (The `actor`
 * sales/agent dimension doesn't change WHO owns the task — only whether the AI
 * acts on their behalf, which is not wired yet.)
 */
export function resolveAssignee(
  ctx: StepExecutionContext,
  assignment: TaskAssignment | undefined,
): string | null {
  if (assignment?.assignTo === "specific") {
    return assignment.userId ?? ctx.enrolment.assigneeId;
  }
  return ctx.contact.ownerId ?? ctx.company.ownerId ?? ctx.enrolment.assigneeId;
}

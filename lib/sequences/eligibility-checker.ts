/**
 * Reasons a contact may be refused enrolment into a sequence. `opted_out` is a
 * hard reject ; the others are exclusion guards that prevent over-contacting.
 */
export type SequenceIneligibilityReason =
  | "opted_out"
  | "active_enrolment_on_contact"
  | "active_enrolment_on_company"
  | "cooldown";

export type SequenceEligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: SequenceIneligibilityReason };

/**
 * Facts the checker needs, loaded by the caller (Slice 3/4 query layer). Keeping
 * the checker free of DB access makes it a pure, unit-testable decision function.
 */
export type SequenceEligibilityContext = {
  /** Contact has opted out of all outreach (hard reject). */
  contactOptedOut: boolean;
  /** Contact already has an active or paused enrolment in any sequence. */
  contactHasActiveEnrolment: boolean;
  /**
   * Another contact at the SAME company has an active or paused enrolment.
   * Prevents hammering a single account through multiple contacts at once.
   */
  companyHasActiveEnrolment: boolean;
  /**
   * When the contact most recently COMPLETED an enrolment (any end reason),
   * or null if never. Used for the post-completion cooldown.
   */
  mostRecentCompletedAt: Date | null;
  now: Date;
};

/**
 * Decides whether a contact may be enrolled. Order matters: opt-out is checked
 * first (hard reject), then the three exclusion guards. The cooldown window is
 * injected (default 30 days) so it can become per-org config later without
 * touching the decision logic.
 */
export class SequenceEligibilityChecker {
  private readonly cooldownMs: number;

  constructor(opts: { cooldownDays?: number } = {}) {
    const days = opts.cooldownDays ?? 30;
    this.cooldownMs = days * 86_400_000;
  }

  check(ctx: SequenceEligibilityContext): SequenceEligibilityVerdict {
    if (ctx.contactOptedOut) {
      return { eligible: false, reason: "opted_out" };
    }
    if (ctx.contactHasActiveEnrolment) {
      return { eligible: false, reason: "active_enrolment_on_contact" };
    }
    if (ctx.companyHasActiveEnrolment) {
      return { eligible: false, reason: "active_enrolment_on_company" };
    }
    if (ctx.mostRecentCompletedAt) {
      const elapsed = ctx.now.getTime() - ctx.mostRecentCompletedAt.getTime();
      if (elapsed < this.cooldownMs) {
        return { eligible: false, reason: "cooldown" };
      }
    }
    return { eligible: true };
  }
}

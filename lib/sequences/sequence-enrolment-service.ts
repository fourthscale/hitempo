import "server-only";
import { eq, and } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contacts } from "@/db/schema";
import { getSequenceById, getStepsForSequence } from "@/db/queries/sequences";
import {
  insertEnrolment,
  contactHasActiveEnrolment,
  companyHasActiveEnrolment,
  mostRecentCompletedEnrolmentAt,
} from "@/db/queries/sequence-enrolments";
import {
  SequenceEligibilityChecker,
  type SequenceEligibilityVerdict,
} from "./eligibility-checker";

export type EnrollResult =
  | { ok: true; enrolmentId: string }
  | { ok: false; reason: string };

/**
 * Orchestrates enrolment : loads the eligibility facts from the DB, runs the
 * pure `SequenceEligibilityChecker`, and (if eligible) inserts an enrolment at
 * the sequence's entry step. Used by the manual-enrol action now and by the
 * cascade executor + auto-enrol path later — all share this one gate so the
 * opt-out / over-contact guards can never be bypassed.
 *
 * Entry-step convention (Phase A) : the published step with the lowest
 * `step_order`. The engine resolves the live step from `current_step_id` with
 * a fallback to `current_step_order`, so a republish keeps in-flight enrolments
 * coherent.
 */
export class SequenceEnrolmentService {
  private readonly db: Db;
  private readonly now: () => Date;

  constructor(deps: { db: Db; now?: () => Date }) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  /** Run the eligibility gate without enrolling (used for previews / cascade). */
  async checkEligibility(
    orgId: string,
    contactId: string,
    companyId: string,
    opts: { cooldownDays?: number | null; excludeSelfContactForCompany?: boolean } = {},
  ): Promise<SequenceEligibilityVerdict> {
    const contact = await this.db.query.contacts.findFirst({
      where: and(eq(contacts.organizationId, orgId), eq(contacts.id, contactId)),
      columns: { optedOut: true },
    });

    const [contactActive, companyActive, lastCompleted] = await Promise.all([
      contactHasActiveEnrolment(this.db, orgId, contactId),
      companyHasActiveEnrolment(
        this.db,
        orgId,
        companyId,
        opts.excludeSelfContactForCompany ? contactId : undefined,
      ),
      mostRecentCompletedEnrolmentAt(this.db, orgId, contactId),
    ]);

    const checker = new SequenceEligibilityChecker({
      cooldownDays: opts.cooldownDays ?? undefined,
    });
    return checker.check({
      contactOptedOut: contact?.optedOut ?? false,
      contactHasActiveEnrolment: contactActive,
      companyHasActiveEnrolment: companyActive,
      mostRecentCompletedAt: lastCompleted,
      now: this.now(),
    });
  }

  /**
   * Enrol a contact into a sequence. Returns `{ ok: false, reason }` when the
   * sequence isn't runnable or the contact isn't eligible — the action layer
   * maps that to a user-facing error.
   */
  async enrollContact(
    orgId: string,
    input: {
      sequenceId: string;
      contactId: string;
      companyId: string;
      assigneeId: string | null;
    },
  ): Promise<EnrollResult> {
    const sequence = await getSequenceById(this.db, orgId, input.sequenceId);
    if (!sequence || !sequence.isActive) {
      return { ok: false, reason: "sequence_not_runnable" };
    }

    const steps = await getStepsForSequence(this.db, input.sequenceId);
    if (steps.length === 0) {
      return { ok: false, reason: "sequence_not_runnable" };
    }
    const entry = steps.reduce((min, s) => (s.stepOrder < min.stepOrder ? s : min), steps[0]!);

    const verdict = await this.checkEligibility(orgId, input.contactId, input.companyId, {
      cooldownDays: sequence.cooldownAfterCompletedDays,
      excludeSelfContactForCompany: sequence.excludeIfCompanyHasActiveSequence === false,
    });
    if (!verdict.eligible) {
      return { ok: false, reason: verdict.reason };
    }

    const row = await insertEnrolment(this.db, orgId, {
      sequenceId: input.sequenceId,
      companyId: input.companyId,
      contactId: input.contactId,
      assigneeId: input.assigneeId,
      currentStepId: entry.id,
      currentStepOrder: entry.stepOrder,
      nextDueAt: this.now(),
    });
    return { ok: true, enrolmentId: row.id };
  }
}

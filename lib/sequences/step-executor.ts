import type {
  SequenceStepActionType,
  SequenceEndReason,
  SequenceContactCtx,
  SequenceCompanyCtx,
  SequenceOrgCtx,
  SequenceEnrolmentCtx,
  SequenceStepCtx,
  SequencePredicate,
} from "./types";
import type { MessageChannel, MessageIntent } from "@/lib/messages/types";
import type { TaskScheduling } from "./scheduling";

/**
 * Side-effecting collaborators an executor needs, injected by the engine
 * (Slice 5). Keeping them behind an interface makes executors unit-testable
 * with mocks and keeps the engine the only place that touches the DB / LLM.
 */
export interface SequenceExecutorServices {
  /**
   * Create a task for the enrolment ; returns the new task id. The
   * implementation handles scheduling (TZ-aware computeTaskSchedule +
   * findNextFreeSlot) — executors pass the step's `scheduling` block as-is.
   */
  createTask(input: {
    organizationId: string;
    companyId: string;
    contactId: string;
    assigneeId: string | null;
    sequenceEnrolmentId: string;
    type: string;
    title: string;
    description: string | null;
    /** Per-step scheduling config (heures TZ contact, quotas, etc.). */
    scheduling?: TaskScheduling;
  }): Promise<{ taskId: string }>;

  /**
   * Generate an AI draft and persist it as a `messages` row (status='draft')
   * linked to the task. Best-effort : on any failure it resolves without
   * throwing so the task still exists (rep falls back to manual). Returns
   * whether a draft was produced.
   */
  generateDraftForTask(input: {
    organizationId: string;
    companyId: string;
    contactId: string;
    taskId: string;
    userId: string | null;
    channel: MessageChannel;
    intent: MessageIntent;
    includeSignal: boolean;
    orientation: string | null;
    locale: "fr" | "en";
  }): Promise<{ drafted: boolean }>;

  /**
   * Cascade-enrol the same contact into another sequence (enroll_in_sequence
   * step). Runs the eligibility checker ; returns the new enrolment id or a
   * skip reason. Never throws on eligibility rejection.
   */
  cascadeEnrol(input: {
    targetSequenceId: string;
    startAtStep: number;
    organizationId: string;
    companyId: string;
    contactId: string;
    assigneeId: string | null;
  }): Promise<{ enrolmentId: string | null; skippedReason?: string }>;

  /** Apply an update_contact step's patch to the contact. Best-effort. */
  updateContact(input: {
    organizationId: string;
    contactId: string;
    patch: { status?: string; role?: string };
  }): Promise<void>;
}

/**
 * Everything an executor reads. The locale chain (contact/company/org) is
 * passed so executors can resolve LocalizedString fields via the resolver.
 */
export type StepExecutionContext = {
  enrolment: SequenceEnrolmentCtx;
  step: SequenceStepCtx;
  contact: SequenceContactCtx;
  company: SequenceCompanyCtx;
  organization: SequenceOrgCtx;
  /** auth user to attribute generated drafts / tasks to (assignee or system). */
  userId: string | null;
  services: SequenceExecutorServices;
  /**
   * Evaluate a predicate against the enrolment's current context. Injected by
   * the engine (which owns the interaction history), so logic steps
   * (conditional_split) can branch without re-loading data.
   */
  evaluatePredicate: (predicate: SequencePredicate) => boolean;
  now: Date;
};

/**
 * What an executor reports back to the engine. The engine persists the
 * execution row, then either ends the enrolment (`markEnded`) or advances
 * via `next_step_ids[navigateTo]`, scheduling the next step `delayMs` out
 * (0 = next tick).
 */
export type StepExecutionResult = {
  taskId?: string | null;
  /** Key into the step's next_step_ids. Phase A executors return 'default'. */
  navigateTo?: string;
  /** Schedule the resulting next step this far in the future (wait_delay). */
  delayMs?: number;
  /**
   * Block on the rep marking the just-created task done before moving on.
   * The engine sets `next_due_at = null` (indefinite wait, ignored by the
   * cron sweep) ; the `sequences/task.completed` event resumes the
   * enrolment when the rep closes the task. Used by send_email /
   * send_linkedin / phone_call — human actions that drive the sequence's
   * actual cadence.
   *
   * Mutually exclusive with `delayMs` (delay-based steps don't wait on a
   * task — they wait on wall-clock time).
   */
  awaitTaskCompletion?: boolean;
  /**
   * Optional safety horizon when `awaitTaskCompletion` is set : if the rep
   * never closes the task, the engine still resumes after this many ms.
   * Omit to wait forever (default). Configured per-step via the step's
   * action config, not by the executor itself.
   */
  awaitTaskTimeoutMs?: number;
  /** End the enrolment instead of advancing. */
  markEnded?: SequenceEndReason;
  notes?: string;
};

/**
 * Strategy contract for one action type. Phase A ships 5 ; Phase B/C add
 * more via Factory registration with no engine change.
 */
export interface SequenceStepExecutor {
  readonly actionType: SequenceStepActionType;
  execute(ctx: StepExecutionContext): Promise<StepExecutionResult>;
}

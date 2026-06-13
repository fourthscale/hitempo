import type {
  SequenceStepActionType,
  SequenceEndReason,
  SequenceContactCtx,
  SequenceCompanyCtx,
  SequenceOrgCtx,
  SequenceEnrolmentCtx,
  SequenceStepCtx,
  SequencePredicate,
  ThreadingMode,
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
    /**
     * Sprint 15 — pre-resolved Gmail thread context (set by the
     * SendMessageStepExecutor when the step's `threadingMode` asked to
     * reply to a previous thread). All three travel together :
     *   - `mailThreadId`         : the thread Gmail should reuse.
     *   - `mailReplyToMessageId` : the message id we'll reply to (for the
     *                                In-Reply-To / References headers).
     *   - `subject`               : the previous subject so the sender can
     *                                build a "Re: <prev>" without joining
     *                                back on `messages`.
     *   - `mailReferences`        : full RFC 5322 References chain (space-
     *                                separated, oldest → newest, includes
     *                                parent at end). Emitted verbatim in
     *                                the MIME `References:` header.
     * Stays null on fresh-thread sends and on non-email tasks.
     */
    mailThreadId?: string | null;
    mailReplyToMessageId?: string | null;
    subject?: string | null;
    mailReferences?: string | null;
  }): Promise<{
    taskId: string;
    /** Resolved scheduledFor (after TZ + work-pattern + anti-conflict
     *  snapping). Null when the step had no scheduling. Passed back so
     *  callers can hand it to the agent auto-execute scheduler. */
    scheduledFor: Date | null;
  }>;

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

  /**
   * Resolve the auth user's first/last name for `{{sender.*}}` template
   * variables. Returns null when the user can't be found (deleted /
   * unknown) — caller falls back to the template's `|| 'default'` clause.
   * Cross-tenant : runs on the admin pool.
   */
  getSenderName(userId: string): Promise<{ firstName: string; lastName: string } | null>;

  /**
   * Sprint 12 phase 4 — schedule a freshly-created `send_email` task for
   * agent auto-execution. Marks the task `auto_execution_status=pending`
   * + emits `sequences/task.auto-execute` so an Inngest function picks
   * it up at `scheduledFor` (or immediately if null/past).
   *
   * Best-effort : a side-effect failure here must NOT abort the engine
   * step. Worst case the task lands in the human queue (the agent flag
   * column stays null), which is a graceful fallback.
   */
  scheduleAgentAutoExecute(input: {
    organizationId: string;
    taskId: string;
    scheduledFor: Date | null;
  }): Promise<void>;

  /**
   * Sprint 15 — resolves the Gmail thread context the next `send_email`
   * task should reply into, based on the step's `threadingMode`. Returns
   * null when no previous thread exists (legitimate for `new_thread`, or
   * defensive fallback for the other modes when the prior step_executions
   * row carries no thread id).
   *
   * The send-side (agent executor + manual dialogs) reads the stamped
   * fields straight off the task — they don't call this method.
   */
  resolveThreadContext(input: {
    organizationId: string;
    contactId: string;
    enrolmentId: string;
    mode: ThreadingMode;
  }): Promise<{
    threadId: string;
    replyToMessageId: string;
    subject: string;
    /** Sprint 15 — full RFC 5322 References chain (oldest → newest). */
    references: string;
  } | null>;
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

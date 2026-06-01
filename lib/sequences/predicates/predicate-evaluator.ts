import type {
  SequenceContactCtx,
  SequenceCompanyCtx,
  SequenceOrgCtx,
  SequenceEnrolmentCtx,
  SequenceInteractionCtx,
} from "../types";
import {
  evaluateConditionGroup,
  type ConditionFacts,
  type ConditionGroup,
} from "../conditions";

/**
 * Context handed to every predicate evaluator at step-execution time.
 *
 * `recentInteractions` is the enrolment contact's interaction trail since
 * the previous step ran (or since enrolment start for the first step) —
 * the engine scopes the window, evaluators just read the list. This keeps
 * evaluators pure + unit-testable.
 */
export type PredicateEvaluationContext = {
  contact: SequenceContactCtx;
  company: SequenceCompanyCtx;
  organization: SequenceOrgCtx;
  enrolment: SequenceEnrolmentCtx;
  recentInteractions: SequenceInteractionCtx[];
  now: Date;
};

/**
 * Strategy contract for a single predicate type. Phase A ships the
 * history-based ones ; Phase B/C register more (property / time / composite)
 * with the same Factory, no engine change.
 */
export interface SequencePredicateEvaluator {
  readonly type: string;
  evaluate(ctx: PredicateEvaluationContext, config?: Record<string, unknown>): boolean;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Inbound = something the prospect sent us. Phase A : the Gmail reply type. */
function isInbound(i: SequenceInteractionCtx): boolean {
  return i.type === "email_received";
}

const POSITIVE_OUTCOMES = new Set(["positive_reply", "rdv_scheduled"]);
const NEGATIVE_OUTCOMES = new Set(["negative_reply", "opted_out"]);

// ---------------------------------------------------------------------------
// Phase A — history-based evaluators
// ---------------------------------------------------------------------------

export class AlwaysEvaluator implements SequencePredicateEvaluator {
  readonly type = "always";
  evaluate(): boolean {
    return true;
  }
}

export class IfNoInboundEvaluator implements SequencePredicateEvaluator {
  readonly type = "if_no_inbound";
  evaluate(ctx: PredicateEvaluationContext): boolean {
    return !ctx.recentInteractions.some(isInbound);
  }
}

export class IfRespondedEvaluator implements SequencePredicateEvaluator {
  readonly type = "if_responded";
  evaluate(ctx: PredicateEvaluationContext): boolean {
    return ctx.recentInteractions.some(isInbound);
  }
}

export class IfPositiveReplyEvaluator implements SequencePredicateEvaluator {
  readonly type = "if_positive_reply";
  evaluate(ctx: PredicateEvaluationContext): boolean {
    return ctx.recentInteractions.some(
      (i) => isInbound(i) && i.outcome != null && POSITIVE_OUTCOMES.has(i.outcome),
    );
  }
}

export class IfNegativeReplyEvaluator implements SequencePredicateEvaluator {
  readonly type = "if_negative_reply";
  evaluate(ctx: PredicateEvaluationContext): boolean {
    return ctx.recentInteractions.some(
      (i) => isInbound(i) && i.outcome != null && NEGATIVE_OUTCOMES.has(i.outcome),
    );
  }
}

/**
 * For call / visit steps : true when the most recent OUTBOUND interaction
 * (status set) is marked 'no_answer'. Useful for "if the call went
 * unanswered, schedule a retry".
 */
export class IfNoAnswerEvaluator implements SequencePredicateEvaluator {
  readonly type = "if_no_answer";
  evaluate(ctx: PredicateEvaluationContext): boolean {
    return mostRecentOutboundNoAnswer(ctx.recentInteractions);
  }
}

function mostRecentOutboundNoAnswer(interactions: SequenceInteractionCtx[]): boolean {
  const outbound = interactions
    .filter((i) => !isInbound(i) && i.status != null)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return outbound[0]?.status === "no_answer";
}

/** Build the flat facts snapshot the composite condition evaluator reads. */
export function buildConditionFacts(ctx: PredicateEvaluationContext): ConditionFacts {
  const inboundAll = ctx.recentInteractions.filter(isInbound);
  // Slice E — interactions whose underlying outbound message belongs to
  // the CURRENT enrolment. The Gmail poller sets `interaction.messageId`
  // on every detected reply ; `messages.sequenceRunId` is the FK back to
  // sequence_enrolments. A reply to a mail the sale sent manually has
  // `sequenceEnrolmentId === null` and therefore drops out of the
  // this-sequence bag.
  const enrolmentId = ctx.enrolment.id;
  const inboundInSequence = inboundAll.filter(
    (i) => i.sequenceEnrolmentId != null && i.sequenceEnrolmentId === enrolmentId,
  );

  const behaviorFlagsFor = (inbound: typeof inboundAll, all: typeof ctx.recentInteractions) => ({
    replied: inbound.length > 0,
    positiveReply: inbound.some((i) => i.outcome != null && POSITIVE_OUTCOMES.has(i.outcome)),
    negativeReply: inbound.some((i) => i.outcome != null && NEGATIVE_OUTCOMES.has(i.outcome)),
    callNoAnswer: mostRecentOutboundNoAnswer(all),
  });

  return {
    contact: {
      status: ctx.contact.status,
      role: ctx.contact.role,
      preferredLanguage: ctx.contact.preferredLanguage,
      optedOut: ctx.contact.optedOut,
      jobTitle: ctx.contact.jobTitle,
    },
    company: {
      relationshipType: ctx.company.relationshipType,
      signalType: ctx.company.signalType,
    },
    behavior: behaviorFlagsFor(inboundAll, ctx.recentInteractions),
    behaviorInSequence: behaviorFlagsFor(
      inboundInSequence,
      ctx.recentInteractions.filter(
        (i) => i.sequenceEnrolmentId != null && i.sequenceEnrolmentId === enrolmentId,
      ),
    ),
  };
}

/**
 * Composite AND/OR condition tree (the Klaviyo-style builder). Config is a
 * `ConditionGroup`. Used by conditional_split / conditional_switch branches.
 */
export class CompositePredicateEvaluator implements SequencePredicateEvaluator {
  readonly type = "composite";
  evaluate(ctx: PredicateEvaluationContext, config?: Record<string, unknown>): boolean {
    const group = config as unknown as ConditionGroup | undefined;
    if (!group || group.kind !== "group") return true;
    return evaluateConditionGroup(group, buildConditionFacts(ctx));
  }
}

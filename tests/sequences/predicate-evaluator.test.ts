import { describe, it, expect } from "vitest";
import type {
  SequenceContactCtx,
  SequenceCompanyCtx,
  SequenceOrgCtx,
  SequenceEnrolmentCtx,
  SequenceInteractionCtx,
} from "@/lib/sequences/types";
import type { PredicateEvaluationContext } from "@/lib/sequences/predicates/predicate-evaluator";
import { SequencePredicateEvaluatorFactory } from "@/lib/sequences/predicates/predicate-evaluator-factory";
import { UnknownPredicateTypeError } from "@/lib/sequences/sequence-errors";

const contact: SequenceContactCtx = {
  id: "c1",
  kind: "person",
  firstName: "Marie",
  lastName: "Durand",
  jobTitle: null,
  preferredLanguage: "fr",
  optedOut: false,
};
const company: SequenceCompanyCtx = {
  id: "co1",
  name: "Hotel X",
  primaryLocale: "fr",
  relationshipType: null,
  signalType: null,
  signalDetectedAt: null,
};
const organization: SequenceOrgCtx = { id: "o1", defaultLocale: "fr" };
const enrolment: SequenceEnrolmentCtx = {
  id: "e1",
  organizationId: "o1",
  sequenceId: "s1",
  companyId: "co1",
  contactId: "c1",
  assigneeId: "u1",
  currentStepId: "st1",
  currentStepOrder: 0,
  lastExecutionCounter: 0,
  maxExecutionCount: 200,
};

function interaction(over: Partial<SequenceInteractionCtx>): SequenceInteractionCtx {
  return {
    id: "i" + Math.round((over.occurredAt?.getTime() ?? 0) % 100000),
    type: "email_sent",
    outcome: null,
    status: null,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function ctx(recentInteractions: SequenceInteractionCtx[]): PredicateEvaluationContext {
  return {
    contact,
    company,
    organization,
    enrolment,
    recentInteractions,
    now: new Date("2026-01-10T00:00:00Z"),
  };
}

const evaluate = (type: string, interactions: SequenceInteractionCtx[]) =>
  SequencePredicateEvaluatorFactory.evaluate({ type }, ctx(interactions));

describe("SequencePredicateEvaluatorFactory", () => {
  it("null predicate is always true", () => {
    expect(SequencePredicateEvaluatorFactory.evaluate(null, ctx([]))).toBe(true);
  });

  it("always → true", () => {
    expect(evaluate("always", [])).toBe(true);
  });

  it("throws on unknown predicate type", () => {
    expect(() => evaluate("nope", [])).toThrow(UnknownPredicateTypeError);
  });

  describe("if_no_inbound / if_responded", () => {
    it("no inbound → if_no_inbound true, if_responded false", () => {
      const out = [interaction({ type: "email_sent" })];
      expect(evaluate("if_no_inbound", out)).toBe(true);
      expect(evaluate("if_responded", out)).toBe(false);
    });
    it("inbound present → inverse", () => {
      const trail = [interaction({ type: "email_sent" }), interaction({ type: "email_received" })];
      expect(evaluate("if_no_inbound", trail)).toBe(false);
      expect(evaluate("if_responded", trail)).toBe(true);
    });
  });

  describe("if_positive_reply / if_negative_reply", () => {
    it("positive inbound reply", () => {
      const trail = [interaction({ type: "email_received", outcome: "positive_reply" })];
      expect(evaluate("if_positive_reply", trail)).toBe(true);
      expect(evaluate("if_negative_reply", trail)).toBe(false);
    });
    it("negative inbound reply", () => {
      const trail = [interaction({ type: "email_received", outcome: "opted_out" })];
      expect(evaluate("if_negative_reply", trail)).toBe(true);
      expect(evaluate("if_positive_reply", trail)).toBe(false);
    });
    it("outcome on outbound is ignored (must be inbound)", () => {
      const trail = [interaction({ type: "email_sent", outcome: "positive_reply" })];
      expect(evaluate("if_positive_reply", trail)).toBe(false);
    });
  });

  describe("if_no_answer", () => {
    it("most recent outbound status no_answer → true", () => {
      const trail = [
        interaction({ type: "call", status: "answered", occurredAt: new Date("2026-01-02") }),
        interaction({ type: "call", status: "no_answer", occurredAt: new Date("2026-01-05") }),
      ];
      expect(evaluate("if_no_answer", trail)).toBe(true);
    });
    it("most recent outbound answered → false", () => {
      const trail = [
        interaction({ type: "call", status: "no_answer", occurredAt: new Date("2026-01-02") }),
        interaction({ type: "call", status: "answered", occurredAt: new Date("2026-01-05") }),
      ];
      expect(evaluate("if_no_answer", trail)).toBe(false);
    });
    it("no outbound with status → false", () => {
      expect(evaluate("if_no_answer", [interaction({ type: "email_received" })])).toBe(false);
    });
  });

  it("isKnownType reflects registry", () => {
    expect(SequencePredicateEvaluatorFactory.isKnownType("if_no_inbound")).toBe(true);
    expect(SequencePredicateEvaluatorFactory.isKnownType("ghost")).toBe(false);
  });
});

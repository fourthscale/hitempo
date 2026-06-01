import { describe, expect, it } from "vitest";
import {
  conditionDependsOnReplyOutcome,
  hasUnqualifiedInboundReply,
  isSequenceUnknownOutcomeStrategy,
  resolveUnknownOutcomeStrategy,
  SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES,
} from "@/lib/sequences/unknown-outcome-strategy";
import type { ConditionGroup } from "@/lib/sequences/conditions";

describe("SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES", () => {
  it("exposes the two canonical strategies in stable order", () => {
    expect(SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES).toEqual(["park", "continue_default"]);
  });

  it("isSequenceUnknownOutcomeStrategy filters valid values", () => {
    expect(isSequenceUnknownOutcomeStrategy("park")).toBe(true);
    expect(isSequenceUnknownOutcomeStrategy("continue_default")).toBe(true);
    expect(isSequenceUnknownOutcomeStrategy("nope")).toBe(false);
    expect(isSequenceUnknownOutcomeStrategy(null)).toBe(false);
  });
});

describe("resolveUnknownOutcomeStrategy", () => {
  it("step override wins", () => {
    expect(
      resolveUnknownOutcomeStrategy({ sequence: "continue_default", step: "park" }),
    ).toBe("park");
  });

  it("falls back to sequence when step null", () => {
    expect(
      resolveUnknownOutcomeStrategy({ sequence: "continue_default", step: null }),
    ).toBe("continue_default");
  });

  it("hard-defaults to park when both missing", () => {
    expect(resolveUnknownOutcomeStrategy({ sequence: null, step: null })).toBe("park");
    expect(resolveUnknownOutcomeStrategy({ sequence: undefined, step: undefined })).toBe("park");
  });

  it("invalid values fall through to park (defensive)", () => {
    expect(
      resolveUnknownOutcomeStrategy({ sequence: "garbage", step: "??" }),
    ).toBe("park");
    expect(
      resolveUnknownOutcomeStrategy({ sequence: "continue_default", step: "??" }),
    ).toBe("continue_default");
  });
});

describe("conditionDependsOnReplyOutcome", () => {
  function group(...conds: ConditionGroup["conditions"]): ConditionGroup {
    return { kind: "group", op: "and", conditions: conds };
  }

  it("returns false for empty / null", () => {
    expect(conditionDependsOnReplyOutcome(null)).toBe(false);
    expect(conditionDependsOnReplyOutcome(undefined)).toBe(false);
    expect(conditionDependsOnReplyOutcome(group())).toBe(false);
  });

  it("true when a leaf reads positiveReply", () => {
    expect(
      conditionDependsOnReplyOutcome(
        group({ kind: "leaf", dimension: "behavior.positiveReply", operator: "happened" }),
      ),
    ).toBe(true);
  });

  it("true when a leaf reads negativeReply", () => {
    expect(
      conditionDependsOnReplyOutcome(
        group({ kind: "leaf", dimension: "behavior.negativeReply", operator: "happened" }),
      ),
    ).toBe(true);
  });

  it("false when only behavior.replied (presence, not classification)", () => {
    expect(
      conditionDependsOnReplyOutcome(
        group({ kind: "leaf", dimension: "behavior.replied", operator: "happened" }),
      ),
    ).toBe(false);
  });

  it("descends into nested groups", () => {
    const nested = group(
      { kind: "leaf", dimension: "contact.status", operator: "equals", value: "to_contact" },
      group({ kind: "leaf", dimension: "behavior.positiveReply", operator: "happened" }),
    );
    expect(conditionDependsOnReplyOutcome(nested)).toBe(true);
  });
});

describe("hasUnqualifiedInboundReply", () => {
  it("true on any email_received with null outcome", () => {
    expect(
      hasUnqualifiedInboundReply([
        { type: "email_received", outcome: null },
        { type: "follow_up", outcome: "positive_reply" },
      ]),
    ).toBe(true);
  });

  it("false when all replies already qualified", () => {
    expect(
      hasUnqualifiedInboundReply([
        { type: "email_received", outcome: "positive_reply" },
      ]),
    ).toBe(false);
  });

  it("false on empty list", () => {
    expect(hasUnqualifiedInboundReply([])).toBe(false);
  });

  it("ignores non-inbound types", () => {
    expect(
      hasUnqualifiedInboundReply([{ type: "follow_up", outcome: null }]),
    ).toBe(false);
  });
});

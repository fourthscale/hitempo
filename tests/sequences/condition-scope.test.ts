import { describe, expect, it } from "vitest";
import { evaluateConditionGroup, type ConditionFacts, type ConditionGroup } from "@/lib/sequences/conditions";

const baseFacts: ConditionFacts = {
  contact: { status: "to_contact", role: null, preferredLanguage: "fr", optedOut: false, jobTitle: null },
  company: { relationshipType: "prospect", signalType: null },
  // any-scope : the contact replied (e.g. to a manual mail)
  behavior: { replied: true, positiveReply: false, negativeReply: false, callNoAnswer: false },
  // this-sequence-scope : no reply linked to the current enrolment
  behaviorInSequence: { replied: false, positiveReply: false, negativeReply: false, callNoAnswer: false },
};

function leaf(dimension: string, operator: string, scope?: "any" | "this_sequence"): ConditionGroup {
  return {
    kind: "group",
    op: "and",
    conditions: [{ kind: "leaf", dimension, operator, ...(scope ? { scope } : {}) }],
  };
}

describe("condition scope (E)", () => {
  it("scope=any reads global behavior bag (default behavior unchanged)", () => {
    // Default scope is "any" → uses `facts.behavior` → replied=true → matches.
    expect(evaluateConditionGroup(leaf("behavior.replied", "happened"), baseFacts)).toBe(true);
  });

  it("explicit scope=any matches default", () => {
    expect(
      evaluateConditionGroup(leaf("behavior.replied", "happened", "any"), baseFacts),
    ).toBe(true);
  });

  it("scope=this_sequence reads the per-sequence bag", () => {
    // this_sequence → uses `facts.behaviorInSequence` → replied=false → no match.
    expect(
      evaluateConditionGroup(leaf("behavior.replied", "happened", "this_sequence"), baseFacts),
    ).toBe(false);
  });

  it("scope=this_sequence with not_happened operator", () => {
    expect(
      evaluateConditionGroup(leaf("behavior.replied", "not_happened", "this_sequence"), baseFacts),
    ).toBe(true);
  });

  it("scope on non-behavior dimension is ignored", () => {
    expect(
      evaluateConditionGroup(
        {
          kind: "group",
          op: "and",
          conditions: [
            { kind: "leaf", dimension: "contact.status", operator: "equals", value: "to_contact", scope: "this_sequence" },
          ],
        },
        baseFacts,
      ),
    ).toBe(true);
  });

  it("positiveReply : sequence-scoped sees only sequence-linked positive replies", () => {
    const facts: ConditionFacts = {
      ...baseFacts,
      behavior: { ...baseFacts.behavior, positiveReply: true },
      behaviorInSequence: { ...baseFacts.behaviorInSequence, positiveReply: false },
    };
    expect(
      evaluateConditionGroup(leaf("behavior.positiveReply", "happened"), facts),
    ).toBe(true);
    expect(
      evaluateConditionGroup(leaf("behavior.positiveReply", "happened", "this_sequence"), facts),
    ).toBe(false);
  });
});

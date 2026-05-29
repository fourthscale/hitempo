import { describe, it, expect } from "vitest";
import {
  evaluateConditionGroup,
  emptyGroup,
  type ConditionFacts,
  type ConditionGroup,
} from "@/lib/sequences/conditions";

const facts: ConditionFacts = {
  contact: {
    status: "qualified",
    role: "decision_maker",
    preferredLanguage: "fr",
    optedOut: false,
    jobTitle: "Directrice",
  },
  company: { relationshipType: "prospect", signalType: null },
  behavior: { replied: true, positiveReply: true, negativeReply: false, callNoAnswer: false },
};

const leaf = (dimension: string, operator: string, value?: string) =>
  ({ kind: "leaf" as const, dimension, operator, value });

describe("evaluateConditionGroup", () => {
  it("an empty group is vacuously true", () => {
    expect(evaluateConditionGroup(emptyGroup(), facts)).toBe(true);
  });

  it("enum equals / not_equals", () => {
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("contact.status", "equals", "qualified")] }, facts),
    ).toBe(true);
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("contact.status", "not_equals", "qualified")] }, facts),
    ).toBe(false);
  });

  it("boolean is_true / is_false", () => {
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("contact.optedOut", "is_false")] }, facts),
    ).toBe(true);
  });

  it("behavior happened / not_happened", () => {
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("behavior.replied", "happened")] }, facts),
    ).toBe(true);
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("behavior.negativeReply", "not_happened")] }, facts),
    ).toBe(true);
  });

  it("AND requires all, OR requires any", () => {
    const a = leaf("contact.status", "equals", "qualified"); // true
    const b = leaf("company.relationshipType", "equals", "client"); // false
    expect(evaluateConditionGroup({ kind: "group", op: "and", conditions: [a, b] }, facts)).toBe(false);
    expect(evaluateConditionGroup({ kind: "group", op: "or", conditions: [a, b] }, facts)).toBe(true);
  });

  it("nested groups", () => {
    const nested: ConditionGroup = {
      kind: "group",
      op: "and",
      conditions: [
        leaf("behavior.replied", "happened"),
        {
          kind: "group",
          op: "or",
          conditions: [
            leaf("contact.role", "equals", "influencer"),
            leaf("contact.role", "equals", "decision_maker"),
          ],
        },
      ],
    };
    expect(evaluateConditionGroup(nested, facts)).toBe(true);
  });

  it("text contains + is_set", () => {
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("contact.jobTitle", "contains", "direct")] }, facts),
    ).toBe(true);
    expect(
      evaluateConditionGroup({ kind: "group", op: "and", conditions: [leaf("company.signalType", "is_set")] }, facts),
    ).toBe(false);
  });
});

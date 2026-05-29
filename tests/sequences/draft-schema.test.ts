import { describe, it, expect } from "vitest";
import {
  draftDefinitionSchema,
  validateDraftGraph,
  type DraftDefinition,
} from "@/lib/sequences/draft-schema";

function linearDraft(): DraftDefinition {
  return {
    entryStepId: "a",
    steps: [
      {
        id: "a",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "ai",
          channel: "email",
          intent: "first_contact",
          titleTemplate: { fr: "Email", en: "Email" },
        },
        nextStepIds: { default: "b" },
        condition: null,
        filter: null,
      },
      {
        id: "b",
        stepOrder: 1,
        actionType: "wait_delay",
        actionConfig: { durationValue: 3, durationUnit: "days" },
        nextStepIds: { default: "c" },
        condition: null,
        filter: null,
      },
      {
        id: "c",
        stepOrder: 2,
        actionType: "phone_call",
        actionConfig: { titleTemplate: { fr: "Appeler", en: "Call" } },
        nextStepIds: null,
        condition: null,
        filter: null,
      },
    ],
  };
}

describe("draftDefinitionSchema", () => {
  it("parses a valid linear draft", () => {
    const parsed = draftDefinitionSchema.parse(linearDraft());
    expect(parsed.steps).toHaveLength(3);
  });

  it("rejects an empty step list", () => {
    expect(draftDefinitionSchema.safeParse({ entryStepId: "a", steps: [] }).success).toBe(false);
  });
});

describe("validateDraftGraph", () => {
  it("accepts a valid linear draft (implicit end)", () => {
    expect(validateDraftGraph(linearDraft())).toEqual([]);
  });

  it("flags a dangling reference + unreachable steps", () => {
    const d = linearDraft();
    d.steps[0]!.nextStepIds = { default: "ghost" };
    const issues = validateDraftGraph(d);
    expect(issues.some((i) => i.code === "dangling_reference")).toBe(true);
    expect(issues.some((i) => i.code === "unreachable_step")).toBe(true);
  });

  it("flags an unknown predicate gate", () => {
    const d = linearDraft();
    d.steps[0]!.condition = { type: "if_full_moon" };
    expect(validateDraftGraph(d).some((i) => i.code === "unknown_predicate_type")).toBe(true);
  });

  it("accepts a known predicate gate", () => {
    const d = linearDraft();
    d.steps[0]!.condition = { type: "if_no_inbound" };
    expect(validateDraftGraph(d)).toEqual([]);
  });

  it("flags invalid action_config (wait without duration)", () => {
    const d = linearDraft();
    d.steps[1]!.actionConfig = { durationUnit: "days" } as Record<string, unknown>;
    expect(validateDraftGraph(d).some((i) => i.code === "invalid_action_config")).toBe(true);
  });

  it("flags an invalid conditional_split config", () => {
    const d = linearDraft();
    d.steps[2]!.actionType = "conditional_split";
    d.steps[2]!.actionConfig = { nope: true } as Record<string, unknown>; // missing condition
    d.steps[2]!.nextStepIds = { yes: "a", no: "b" };
    expect(validateDraftGraph(d).some((i) => i.code === "invalid_action_config")).toBe(true);
  });

  it("accepts a conditional_split with a composite condition (branches default to End)", () => {
    const d = linearDraft();
    d.steps[2]!.actionType = "conditional_split";
    d.steps[2]!.actionConfig = { condition: { kind: "group", op: "and", conditions: [] } };
    d.steps[2]!.nextStepIds = { yes: "a", no: "b" };
    expect(validateDraftGraph(d)).toEqual([]);
  });

  it("flags entry not found + duplicate ids", () => {
    const d = linearDraft();
    d.entryStepId = "missing";
    expect(validateDraftGraph(d).some((i) => i.code === "entry_not_found")).toBe(true);

    const d2 = linearDraft();
    d2.steps[1]!.id = "a";
    expect(validateDraftGraph(d2).some((i) => i.code === "duplicate_step_id")).toBe(true);
  });

  it("allows a loop back to an earlier step", () => {
    const d = linearDraft();
    d.steps[1]!.nextStepIds = { default: "a" };
    d.steps = d.steps.filter((s) => s.id !== "c");
    expect(validateDraftGraph(d)).toEqual([]);
  });
});

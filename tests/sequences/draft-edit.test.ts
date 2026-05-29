import { describe, it, expect } from "vitest";
import {
  reachableStepIds,
  gcUnreachableSteps,
  repointRefs,
  deleteStepKeepingPath,
  targetForSlot,
  moveStep,
  joinBranches,
  unmergeStep,
  isMovableStep,
} from "@/lib/sequences/draft-edit";
import type { DraftStep, DraftDefinition } from "@/lib/sequences/draft-schema";
import type { NextStepIds } from "@/lib/sequences/types";

function step(id: string, next: NextStepIds, type: DraftStep["actionType"] = "send_email"): DraftStep {
  return {
    id,
    stepOrder: 0,
    actionType: type,
    actionConfig: {} as DraftStep["actionConfig"],
    nextStepIds: next,
    condition: null,
    filter: null,
  };
}

describe("reachableStepIds", () => {
  it("follows default / yes / no / cases edges", () => {
    const steps = [
      step("a", { default: "b" }),
      step("b", { yes: "c", no: "d" }, "conditional_split"),
      step("c", null),
      step("d", { cases: { "0": "e" }, default: "f" }, "conditional_switch"),
      step("e", null),
      step("f", null),
    ];
    expect([...reachableStepIds(steps, "a")].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("excludes islands not reachable from entry", () => {
    const steps = [step("a", { default: "b" }), step("b", null), step("orphan", null)];
    expect(reachableStepIds(steps, "a").has("orphan")).toBe(false);
  });

  it("terminates on cycles", () => {
    const steps = [step("a", { default: "b" }), step("b", { default: "a" })];
    expect([...reachableStepIds(steps, "a")].sort()).toEqual(["a", "b"]);
  });
});

describe("gcUnreachableSteps", () => {
  it("drops orphaned subtree left by a removed switch branch", () => {
    // switch reaches case 0 only ; the step on the removed branch (x→y) is an island
    const draft: DraftDefinition = {
      entryStepId: "sw",
      steps: [
        step("sw", { cases: { "0": "kept" } }, "conditional_switch"),
        step("kept", null),
        step("x", { default: "y" }),
        step("y", null),
      ],
    };
    const out = gcUnreachableSteps(draft);
    expect(out.steps.map((s) => s.id).sort()).toEqual(["kept", "sw"]);
  });

  it("keeps a merge step still reachable from another branch", () => {
    const draft: DraftDefinition = {
      entryStepId: "sw",
      steps: [
        step("sw", { cases: { "0": "merge", "1": "merge" } }, "conditional_switch"),
        step("merge", null),
      ],
    };
    expect(gcUnreachableSteps(draft).steps).toHaveLength(2);
  });

  it("is a no-op when everything is reachable", () => {
    const draft: DraftDefinition = {
      entryStepId: "a",
      steps: [step("a", { default: "b" }), step("b", null)],
    };
    expect(gcUnreachableSteps(draft)).toBe(draft);
  });
});

describe("repointRefs", () => {
  it("heals a linear chain : predecessor skips to the continuation", () => {
    // w → x → y ; delete x with heal=y → w now points to y
    const steps = [step("w", { default: "x" }), step("y", null)];
    const out = repointRefs(steps, "x", "y");
    expect(out.find((s) => s.id === "w")!.nextStepIds).toEqual({ default: "y" });
  });

  it("removes the slot when there is no replacement", () => {
    const steps = [step("w", { default: "x" })];
    const out = repointRefs(steps, "x", undefined);
    expect(out.find((s) => s.id === "w")!.nextStepIds).toBeNull();
  });

  it("re-points a switch case and prunes empty cases", () => {
    const steps = [step("sw", { cases: { "0": "x", "1": "k" } }, "conditional_switch")];
    const out = repointRefs(steps, "x", "z");
    expect(out[0].nextStepIds).toEqual({ cases: { "0": "z", "1": "k" } });

    const dropped = repointRefs([step("sw", { cases: { "0": "x" } }, "conditional_switch")], "x", undefined);
    expect(dropped[0].nextStepIds).toBeNull();
  });
});

describe("targetForSlot", () => {
  it("reads each slot kind", () => {
    const n = { default: "d", yes: "y", no: "n", cases: { "0": "a", "1": "b" } };
    expect(targetForSlot(n, "default")).toBe("d");
    expect(targetForSlot(n, "yes")).toBe("y");
    expect(targetForSlot(n, "no")).toBe("n");
    expect(targetForSlot(n, "case:1")).toBe("b");
    expect(targetForSlot(null, "default")).toBeUndefined();
  });
});

describe("deleteStepKeepingPath", () => {
  // entry → split(yes→A→tail, no→B) ; A and B carry subtrees
  const splitDraft = (): DraftDefinition => ({
    entryStepId: "sp",
    steps: [
      step("sp", { yes: "a", no: "b" }, "conditional_split"),
      step("a", { default: "atail" }),
      step("atail", null),
      step("b", null),
    ],
  });

  it("keeps the YES path : promotes A, drops the NO subtree", () => {
    const out = deleteStepKeepingPath(splitDraft(), "sp", "yes");
    expect(out.entryStepId).toBe("a"); // split was entry → kept path promoted
    expect(out.steps.map((s) => s.id).sort()).toEqual(["a", "atail"]);
  });

  it("keeps the NO path : promotes B, drops the YES subtree", () => {
    const out = deleteStepKeepingPath(splitDraft(), "sp", "no");
    expect(out.entryStepId).toBe("b");
    expect(out.steps.map((s) => s.id)).toEqual(["b"]);
  });

  it("deletes all paths when keepSlot is null", () => {
    const out = deleteStepKeepingPath(splitDraft(), "sp", null);
    expect(out.steps).toHaveLength(0);
    expect(out.entryStepId).toBe("");
  });

  it("re-points a non-entry predecessor to the kept path", () => {
    // w → sp(yes→a, no→b) ; keep yes → w now points to a
    const draft: DraftDefinition = {
      entryStepId: "w",
      steps: [
        step("w", { default: "sp" }),
        step("sp", { yes: "a", no: "b" }, "conditional_split"),
        step("a", null),
        step("b", null),
      ],
    };
    const out = deleteStepKeepingPath(draft, "sp", "yes");
    expect(out.entryStepId).toBe("w");
    expect(out.steps.find((s) => s.id === "w")!.nextStepIds).toEqual({ default: "a" });
    expect(out.steps.map((s) => s.id).sort()).toEqual(["a", "w"]);
  });

  it("keeps a chosen switch branch and drops the rest", () => {
    const draft: DraftDefinition = {
      entryStepId: "sw",
      steps: [
        step("sw", { cases: { "0": "x", "1": "y" }, default: "z" }, "conditional_switch"),
        step("x", null),
        step("y", null),
        step("z", null),
      ],
    };
    const out = deleteStepKeepingPath(draft, "sw", "case:1");
    expect(out.entryStepId).toBe("y");
    expect(out.steps.map((s) => s.id)).toEqual(["y"]);
  });
});

describe("isMovableStep", () => {
  it("rejects conditionals and merge, accepts action steps", () => {
    expect(isMovableStep("send_email")).toBe(true);
    expect(isMovableStep("wait_delay")).toBe(true);
    expect(isMovableStep("conditional_split")).toBe(false);
    expect(isMovableStep("conditional_switch")).toBe(false);
    expect(isMovableStep("merge")).toBe(false);
  });
});

describe("moveStep", () => {
  // a → b → c → end
  const linear = (): DraftDefinition => ({
    entryStepId: "a",
    steps: [step("a", { default: "b" }), step("b", { default: "c" }), step("c", null)],
  });

  it("moves a middle step to the entry slot, healing the gap", () => {
    // move c to the trigger (entry) : c becomes entry → a, b follow
    const out = moveStep(linear(), "c", null, "entry")!;
    expect(out).not.toBeNull();
    expect(out.entryStepId).toBe("c");
    expect(out.steps.find((s) => s.id === "c")!.nextStepIds).toEqual({ default: "a" });
    expect(out.steps.find((s) => s.id === "b")!.nextStepIds).toBeNull(); // b was c's predecessor, now ends
  });

  it("moves a step down and heals its old slot", () => {
    // move b after c : a → c → b → end
    const out = moveStep(linear(), "b", "c", "default")!;
    expect(out.entryStepId).toBe("a");
    expect(out.steps.find((s) => s.id === "a")!.nextStepIds).toEqual({ default: "c" });
    expect(out.steps.find((s) => s.id === "c")!.nextStepIds).toEqual({ default: "b" });
    expect(out.steps.find((s) => s.id === "b")!.nextStepIds).toBeNull();
  });

  it("returns null for a no-op (already at that position)", () => {
    expect(moveStep(linear(), "b", "a", "default")).toBeNull();
  });

  it("returns null for a non-movable step", () => {
    const d: DraftDefinition = {
      entryStepId: "sp",
      steps: [step("sp", { yes: "a", no: "b" }, "conditional_split"), step("a", null), step("b", null)],
    };
    expect(moveStep(d, "sp", null, "entry")).toBeNull();
  });

  it("moves the entry step below another (no cycle — interposes on an edge)", () => {
    // move a (entry) after c : b becomes entry → c → a → end
    const out = moveStep(linear(), "a", "c", "default")!;
    expect(out.entryStepId).toBe("b");
    expect(out.steps.find((s) => s.id === "c")!.nextStepIds).toEqual({ default: "a" });
    expect(out.steps.find((s) => s.id === "a")!.nextStepIds).toBeNull();
  });
});

describe("joinBranches", () => {
  // split sp : yes→a (open after), no→b (open after)
  const splitOpen = (): DraftDefinition => ({
    entryStepId: "sp",
    steps: [
      step("sp", { yes: "a", no: "b" }, "conditional_split"),
      step("a", null),
      step("b", null),
    ],
  });

  it("joins two branch ends through a new merge node", () => {
    // a's continuation (open) joined with b's continuation (open)
    const out = joinBranches(splitOpen(), "m1", "a", "default", "b", "default")!;
    expect(out).not.toBeNull();
    expect(out.steps.find((s) => s.id === "a")!.nextStepIds).toEqual({ default: "m1" });
    expect(out.steps.find((s) => s.id === "b")!.nextStepIds).toEqual({ default: "m1" });
    const merge = out.steps.find((s) => s.id === "m1")!;
    expect(merge.actionType).toBe("merge");
    expect(merge.nextStepIds).toBeNull();
  });

  it("joins two ends of the same step", () => {
    const out = joinBranches(splitOpen(), "m1", "sp", "yes", "sp", "no")!;
    const sp = out.steps.find((s) => s.id === "sp")!;
    expect(sp.nextStepIds).toEqual({ yes: "m1", no: "m1" });
    // a and b are now unreachable → GC'd
    expect(out.steps.map((s) => s.id).sort()).toEqual(["m1", "sp"]);
  });

  it("returns null when joining an end to itself", () => {
    expect(joinBranches(splitOpen(), "m1", "a", "default", "a", "default")).toBeNull();
  });
});

describe("unmergeStep", () => {
  it("re-opens the joined branches (no continuation)", () => {
    // sp: yes→a→m, no→b→m ; m→End. Unmerge → a and b re-open, m gone.
    const draft: DraftDefinition = {
      entryStepId: "sp",
      steps: [
        step("sp", { yes: "a", no: "b" }, "conditional_split"),
        step("a", { default: "m" }),
        step("b", { default: "m" }),
        step("m", null, "merge"),
      ],
    };
    const out = unmergeStep(draft, "m");
    expect(out.steps.find((s) => s.id === "m")).toBeUndefined();
    expect(out.steps.find((s) => s.id === "a")!.nextStepIds).toBeNull();
    expect(out.steps.find((s) => s.id === "b")!.nextStepIds).toBeNull();
    expect(out.steps.map((s) => s.id).sort()).toEqual(["a", "b", "sp"]);
  });

  it("keeps the post-merge continuation on the first feeder", () => {
    const draft: DraftDefinition = {
      entryStepId: "sp",
      steps: [
        step("sp", { yes: "a", no: "b" }, "conditional_split"),
        step("a", { default: "m" }),
        step("b", { default: "m" }),
        step("m", { default: "tail" }, "merge"),
        step("tail", null),
      ],
    };
    const out = unmergeStep(draft, "m");
    // first feeder (a) keeps the continuation ; b re-opens
    expect(out.steps.find((s) => s.id === "a")!.nextStepIds).toEqual({ default: "tail" });
    expect(out.steps.find((s) => s.id === "b")!.nextStepIds).toBeNull();
    expect(out.steps.find((s) => s.id === "tail")).toBeDefined();
  });
});

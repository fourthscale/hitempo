import { describe, it, expect } from "vitest";
import { isFirstSendEmailStep } from "@/lib/sequences/is-first-send-email-step";
import type { DraftDefinition, DraftStep } from "@/lib/sequences/draft-schema";

/** Small builder so the tests read like the sequences they describe. */
function step(
  id: string,
  actionType: DraftStep["actionType"],
  nextStepIds: DraftStep["nextStepIds"] = null,
): DraftStep {
  return {
    id,
    stepOrder: 0,
    actionType,
    actionConfig: {},
    nextStepIds,
    condition: null,
    filter: null,
  };
}

function draft(entry: string, steps: DraftStep[]): DraftDefinition {
  return { entryStepId: entry, steps };
}

describe("isFirstSendEmailStep", () => {
  it("returns true on a single send_email step (the entry itself)", () => {
    const d = draft("a", [step("a", "send_email")]);
    expect(isFirstSendEmailStep(d, "a")).toBe(true);
  });

  it("returns true on the first send_email of a linear chain", () => {
    // trigger → wait → email1 → wait → email2
    const d = draft("trigger", [
      step("trigger", "wait_delay", { default: "wait1" }),
      step("wait1", "wait_delay", { default: "email1" }),
      step("email1", "send_email", { default: "wait2" }),
      step("wait2", "wait_delay", { default: "email2" }),
      step("email2", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "email1")).toBe(true);
    expect(isFirstSendEmailStep(d, "email2")).toBe(false);
  });

  it("non-send_email step always returns true (irrelevant check)", () => {
    // The lock only matters for send_email. Wait/phone never need
    // threading anyway, so the function just short-circuits true.
    const d = draft("email1", [
      step("email1", "send_email", { default: "wait1" }),
      step("wait1", "wait_delay"),
    ]);
    expect(isFirstSendEmailStep(d, "wait1")).toBe(true);
  });

  it("conditional split with email on ONE branch only — target on the other branch is still first", () => {
    // trigger → split → yes:email_a / no:email_b
    // Both `email_a` and `email_b` are first (each has zero prior send_email
    // on its own path from entry).
    const d = draft("trigger", [
      step("trigger", "conditional_split", { yes: "email_a", no: "email_b" }),
      step("email_a", "send_email"),
      step("email_b", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "email_a")).toBe(true);
    expect(isFirstSendEmailStep(d, "email_b")).toBe(true);
  });

  it("split where ONE branch passes through a send_email before the target — target is NOT first", () => {
    // The brief's documented edge case :
    // trigger → split → yes:email_early → merge → target_email
    //                → no:wait → merge → target_email
    // ONE path (via yes) has a prior send_email ; the other (no) doesn't.
    // Strict semantics : the step is NOT first because the engine could
    // legitimately arrive after a prior email send.
    const d = draft("trigger", [
      step("trigger", "conditional_split", { yes: "email_early", no: "wait_n" }),
      step("email_early", "send_email", { default: "merge_node" }),
      step("wait_n", "wait_delay", { default: "merge_node" }),
      step("merge_node", "merge", { default: "target_email" }),
      step("target_email", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "email_early")).toBe(true);
    expect(isFirstSendEmailStep(d, "target_email")).toBe(false);
  });

  it("split where BOTH branches pass through a send_email — target is NOT first", () => {
    const d = draft("trigger", [
      step("trigger", "conditional_split", { yes: "email_yes", no: "email_no" }),
      step("email_yes", "send_email", { default: "merge_node" }),
      step("email_no", "send_email", { default: "merge_node" }),
      step("merge_node", "merge", { default: "target_email" }),
      step("target_email", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "target_email")).toBe(false);
  });

  it("split where NO branch passes through a send_email — target IS first", () => {
    const d = draft("trigger", [
      step("trigger", "conditional_split", { yes: "wait_yes", no: "wait_no" }),
      step("wait_yes", "wait_delay", { default: "merge_node" }),
      step("wait_no", "wait_delay", { default: "merge_node" }),
      step("merge_node", "merge", { default: "target_email" }),
      step("target_email", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "target_email")).toBe(true);
  });

  it("switch with multiple cases — first iff EVERY case is send_email-free upstream", () => {
    // trigger → switch → case_a:wait / case_b:email / case_c:wait → all → target
    // case_b passes through send_email → target is NOT first.
    const d = draft("trigger", [
      step("trigger", "conditional_switch", {
        cases: { a: "wait_a", b: "email_b", c: "wait_c" },
      }),
      step("wait_a", "wait_delay", { default: "target_email" }),
      step("email_b", "send_email", { default: "target_email" }),
      step("wait_c", "wait_delay", { default: "target_email" }),
      step("target_email", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "target_email")).toBe(false);
  });

  it("unknown stepId returns true (defensive — caller asked about a step not in the draft)", () => {
    const d = draft("trigger", [
      step("trigger", "wait_delay", { default: "email1" }),
      step("email1", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "does_not_exist")).toBe(true);
  });

  it("empty entryStepId returns true (defensive — malformed draft)", () => {
    const d: DraftDefinition = {
      entryStepId: "",
      steps: [step("a", "send_email")],
    };
    expect(isFirstSendEmailStep(d, "a")).toBe(true);
  });

  it("dangling next ref (broken graph) does not crash — target unreachable → still first", () => {
    // trigger.default points at a step that doesn't exist. The BFS skips
    // dangling refs and the target is reachable via no path → first.
    const d = draft("trigger", [
      step("trigger", "wait_delay", { default: "ghost" }),
      step("email1", "send_email"),
    ]);
    expect(isFirstSendEmailStep(d, "email1")).toBe(true);
  });

  it("cycle in the graph doesn't hang — sawSend dedup terminates BFS", () => {
    // a → b → a → ... (no send_email anywhere)
    // Target is a send_email NOT in the cycle.
    const d = draft("a", [
      step("a", "wait_delay", { default: "b" }),
      step("b", "wait_delay", { default: "a" }),
      step("target", "send_email"),
    ]);
    // target unreachable from entry → considered first (default true).
    expect(isFirstSendEmailStep(d, "target")).toBe(true);
  });
});

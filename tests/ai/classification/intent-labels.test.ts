import { describe, expect, it } from "vitest";
import {
  INTENT_LABELS,
  intentToOutcome,
  isIntentLabel,
} from "@/lib/ai/classification/intent-labels";

describe("intent labels", () => {
  it("exposes the 7 canonical labels", () => {
    expect(INTENT_LABELS).toEqual([
      "positive",
      "negative",
      "out_of_office",
      "wrong_person",
      "unsubscribe",
      "neutral",
      "unknown",
    ]);
  });

  it("isIntentLabel only accepts known values", () => {
    for (const label of INTENT_LABELS) expect(isIntentLabel(label)).toBe(true);
    expect(isIntentLabel("maybe")).toBe(false);
    expect(isIntentLabel("")).toBe(false);
    expect(isIntentLabel(null)).toBe(false);
    expect(isIntentLabel(42)).toBe(false);
  });

  it("intentToOutcome maps actionable labels to the interaction_outcome enum", () => {
    expect(intentToOutcome("positive")).toBe("positive_reply");
    expect(intentToOutcome("negative")).toBe("negative_reply");
    expect(intentToOutcome("out_of_office")).toBe("out_of_office");
    expect(intentToOutcome("wrong_person")).toBe("wrong_contact");
    expect(intentToOutcome("unsubscribe")).toBe("opted_out");
  });

  it("intentToOutcome returns null for non-actionable labels", () => {
    expect(intentToOutcome("neutral")).toBeNull();
    expect(intentToOutcome("unknown")).toBeNull();
  });
});

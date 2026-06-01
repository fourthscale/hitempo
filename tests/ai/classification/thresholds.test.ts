import { describe, expect, it } from "vitest";
import {
  AUTO_APPLY_THRESHOLD,
  REVIEW_THRESHOLD,
  tierForConfidence,
} from "@/lib/ai/classification/thresholds";

describe("confidence thresholds", () => {
  it("auto when confidence >= AUTO_APPLY_THRESHOLD", () => {
    expect(tierForConfidence(AUTO_APPLY_THRESHOLD)).toBe("auto");
    expect(tierForConfidence(0.95)).toBe("auto");
    expect(tierForConfidence(1)).toBe("auto");
  });

  it("review when REVIEW_THRESHOLD <= confidence < AUTO_APPLY_THRESHOLD", () => {
    expect(tierForConfidence(REVIEW_THRESHOLD)).toBe("review");
    expect(tierForConfidence(0.7)).toBe("review");
    expect(tierForConfidence(0.84999)).toBe("review");
  });

  it("low when confidence < REVIEW_THRESHOLD", () => {
    expect(tierForConfidence(0)).toBe("low");
    expect(tierForConfidence(0.59)).toBe("low");
  });
});

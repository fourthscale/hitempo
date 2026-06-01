import { describe, expect, it } from "vitest";
import { parseClassificationResponse } from "@/lib/ai/classification/parse-response";

describe("parseClassificationResponse", () => {
  it("parses a clean JSON object", () => {
    const out = parseClassificationResponse(
      `{"label":"positive","confidence":0.92,"reasoning":"Asks to schedule a call"}`,
    );
    expect(out).toEqual({
      label: "positive",
      confidence: 0.92,
      reasoning: "Asks to schedule a call",
    });
  });

  it("strips markdown fences", () => {
    const out = parseClassificationResponse(
      '```json\n{"label":"negative","confidence":0.8,"reasoning":"Not interested"}\n```',
    );
    expect(out?.label).toBe("negative");
    expect(out?.confidence).toBe(0.8);
  });

  it("coerces a string confidence", () => {
    const out = parseClassificationResponse(
      `{"label":"neutral","confidence":"0.5","reasoning":"meh"}`,
    );
    expect(out?.confidence).toBe(0.5);
  });

  it("rejects unknown labels", () => {
    const out = parseClassificationResponse(
      `{"label":"maybe","confidence":0.9,"reasoning":"x"}`,
    );
    expect(out).toBeNull();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(
      parseClassificationResponse(`{"label":"positive","confidence":1.5,"reasoning":"x"}`),
    ).toBeNull();
    expect(
      parseClassificationResponse(`{"label":"positive","confidence":-0.1,"reasoning":"x"}`),
    ).toBeNull();
  });

  it("rejects non-finite confidence", () => {
    expect(
      parseClassificationResponse(`{"label":"positive","confidence":"NaN","reasoning":"x"}`),
    ).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(parseClassificationResponse(`not json`)).toBeNull();
    expect(parseClassificationResponse(``)).toBeNull();
    expect(parseClassificationResponse(`null`)).toBeNull();
  });

  it("truncates over-long reasoning", () => {
    const longReason = "x".repeat(500);
    const out = parseClassificationResponse(
      `{"label":"positive","confidence":0.9,"reasoning":"${longReason}"}`,
    );
    expect(out?.reasoning.length).toBe(240);
  });
});

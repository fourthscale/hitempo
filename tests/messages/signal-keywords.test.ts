import { describe, it, expect } from "vitest";
import { getSignalKeywords } from "@/lib/messages/signal-keywords";

describe("getSignalKeywords", () => {
  it("returns FR stems for renovation", () => {
    const out = getSignalKeywords("renovation", "fr");
    expect(out).toContain("rénov");
  });

  it("returns EN stems for renovation", () => {
    const out = getSignalKeywords("renovation", "en");
    expect(out).toContain("renov");
  });

  it("returns FR-specific stems for opening", () => {
    const out = getSignalKeywords("opening", "fr");
    expect(out).toEqual(expect.arrayContaining(["ouvertur", "ouverture"]));
  });

  it("returns fundraising keywords distinct per locale", () => {
    expect(getSignalKeywords("fundraising", "fr")).toContain("levée de fonds");
    expect(getSignalKeywords("fundraising", "en")).toContain("fundraising");
  });

  it("returns empty array for null/undefined/empty signalType", () => {
    expect(getSignalKeywords(null, "fr")).toEqual([]);
    expect(getSignalKeywords(undefined, "fr")).toEqual([]);
  });

  it("falls back to the raw signalType when no map entry exists", () => {
    expect(getSignalKeywords("unknown_event", "fr")).toEqual(["unknown_event"]);
  });

  it("is case-insensitive on the signalType key", () => {
    expect(getSignalKeywords("RENOVATION", "en")).toContain("renov");
  });
});

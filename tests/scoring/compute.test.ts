import { describe, it, expect } from "vitest";
import { computeCompanyScore, type ScoringInputs } from "@/lib/scoring/compute";

const NOW = new Date("2026-05-27T12:00:00Z");

const base: ScoringInputs = {
  standing: null,
  signalType: null,
  signalDetectedAt: null,
  interactionCount: 0,
  lastInteractionAt: null,
  openTaskCount: 0,
  hasPrimaryContact: false,
};

describe("computeCompanyScore", () => {
  it("returns 0 for a company with no data", () => {
    const result = computeCompanyScore(base, NOW);
    expect(result.total).toBe(0);
  });

  it("scores standing correctly", () => {
    expect(computeCompanyScore({ ...base, standing: 5 }, NOW).standing.pts).toBe(25);
    expect(computeCompanyScore({ ...base, standing: 4 }, NOW).standing.pts).toBe(20);
    expect(computeCompanyScore({ ...base, standing: 3 }, NOW).standing.pts).toBe(15);
    expect(computeCompanyScore({ ...base, standing: 1 }, NOW).standing.pts).toBe(5);
    expect(computeCompanyScore({ ...base, standing: null }, NOW).standing.pts).toBe(0);
  });

  it("awards signal base pts when signal_type is set", () => {
    const result = computeCompanyScore({ ...base, signalType: "renovation" }, NOW);
    expect(result.signal.pts).toBe(20);
  });

  it("adds recency bonus when signal is within 30 days", () => {
    const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    const result = computeCompanyScore({ ...base, signalType: "renovation", signalDetectedAt: recent }, NOW);
    expect(result.signal.pts).toBe(30);
  });

  it("does not add recency bonus when signal is older than 30 days", () => {
    const old = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
    const result = computeCompanyScore({ ...base, signalType: "renovation", signalDetectedAt: old }, NOW);
    expect(result.signal.pts).toBe(20);
  });

  it("caps interaction base at 4 interactions (20 pts)", () => {
    expect(computeCompanyScore({ ...base, interactionCount: 4 }, NOW).engagement.pts).toBe(20);
    expect(computeCompanyScore({ ...base, interactionCount: 10 }, NOW).engagement.pts).toBe(20);
  });

  it("adds interaction recency bonus within 14 days", () => {
    const recent = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = computeCompanyScore({ ...base, interactionCount: 2, lastInteractionAt: recent }, NOW);
    expect(result.engagement.pts).toBe(20); // 2*5 + 10
  });

  it("no interaction recency bonus after 14 days", () => {
    const old = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000);
    const result = computeCompanyScore({ ...base, interactionCount: 2, lastInteractionAt: old }, NOW);
    expect(result.engagement.pts).toBe(10); // 2*5 only
  });

  it("awards 10 pts for open task", () => {
    expect(computeCompanyScore({ ...base, openTaskCount: 1 }, NOW).tasks.pts).toBe(10);
    expect(computeCompanyScore({ ...base, openTaskCount: 3 }, NOW).tasks.pts).toBe(10);
    expect(computeCompanyScore({ ...base, openTaskCount: 0 }, NOW).tasks.pts).toBe(0);
  });

  it("awards 5 pts for primary contact defined", () => {
    expect(computeCompanyScore({ ...base, hasPrimaryContact: true }, NOW).contact.pts).toBe(5);
    expect(computeCompanyScore({ ...base, hasPrimaryContact: false }, NOW).contact.pts).toBe(0);
  });

  it("caps total at 100", () => {
    const perfect: ScoringInputs = {
      standing: 5,
      signalType: "renovation",
      signalDetectedAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
      interactionCount: 10,
      lastInteractionAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
      openTaskCount: 2,
      hasPrimaryContact: true,
    };
    expect(computeCompanyScore(perfect, NOW).total).toBe(100);
  });

  it("computes a realistic partial score", () => {
    const inputs: ScoringInputs = {
      standing: 4,           // 20
      signalType: "opening", // 20
      signalDetectedAt: null,
      interactionCount: 2,   // 10
      lastInteractionAt: null,
      openTaskCount: 1,      // 10
      hasPrimaryContact: true, // 5
    };
    expect(computeCompanyScore(inputs, NOW).total).toBe(65);
  });

  it("includes computedAt in breakdown", () => {
    const result = computeCompanyScore(base, NOW);
    expect(result.computedAt).toBe(NOW.toISOString());
  });
});

import { describe, it, expect, vi } from "vitest";

import { ScoringEngine } from "@/lib/scoring/scoring-engine";
import { ScoringEngineFactory } from "@/lib/scoring/scoring-engine-factory";
import { DefaultScoringStrategy } from "@/lib/scoring/strategies/default-scoring-strategy";
import type { ScoringRepository } from "@/lib/scoring/scoring-repository";
import type { ScoringStrategy } from "@/lib/scoring/scoring-strategy";
import type { ScoringInputs, ScoreBreakdown } from "@/lib/scoring/scoring-types";

const ORG = "00000000-0000-0000-0000-000000000001";
const COMPANY = "00000000-0000-0000-0000-000000000002";

const baseInputs: ScoringInputs = {
  standing: 4,
  signalType: "renovation",
  signalDetectedAt: new Date(),
  interactionCount: 2,
  lastInteractionAt: new Date(),
  openTaskCount: 1,
  hasPrimaryContact: true,
};

function makeRepo(opts: {
  inputs?: ScoringInputs | null;
  onPersist?: (
    orgId: string,
    companyId: string,
    total: number,
    breakdown: ScoreBreakdown,
  ) => void;
}): ScoringRepository {
  return {
    getInputs: vi
      .fn()
      .mockResolvedValue(opts.inputs === undefined ? baseInputs : opts.inputs),
    persistScore: vi.fn().mockImplementation(async (...args) => {
      opts.onPersist?.(
        ...(args as [string, string, number, ScoreBreakdown]),
      );
    }),
  };
}

// ---------------------------------------------------------------------------
// DefaultScoringStrategy — quick smoke test (full coverage lives in
// tests/scoring/compute.test.ts which goes through the shim)
// ---------------------------------------------------------------------------

describe("DefaultScoringStrategy", () => {
  it("identifies itself with name = 'default'", () => {
    expect(new DefaultScoringStrategy().name).toBe("default");
  });

  it("is pure : same inputs + same now => same output", () => {
    const s = new DefaultScoringStrategy();
    const now = new Date("2026-05-27T12:00:00Z");
    const a = s.score(baseInputs, now);
    const b = s.score(baseInputs, now);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// ScoringEngine
// ---------------------------------------------------------------------------

describe("ScoringEngine.recompute", () => {
  it("calls the strategy with the repository's inputs and persists the result", async () => {
    let persisted: { total: number; breakdown: ScoreBreakdown } | null = null;
    const repo = makeRepo({
      onPersist: (_o, _c, total, breakdown) => {
        persisted = { total, breakdown };
      },
    });
    const engine = new ScoringEngine(new DefaultScoringStrategy(), repo);

    const result = await engine.recompute(ORG, COMPANY);

    expect(result).not.toBeNull();
    expect(persisted).not.toBeNull();
    expect(persisted!.total).toBe(result!.total);
    expect(persisted!.breakdown).toEqual(result);
  });

  it("returns null and skips persist when the company doesn't resolve", async () => {
    const repo = makeRepo({ inputs: null });
    const engine = new ScoringEngine(new DefaultScoringStrategy(), repo);

    const result = await engine.recompute(ORG, COMPANY);

    expect(result).toBeNull();
    expect(vi.mocked(repo.persistScore)).not.toHaveBeenCalled();
  });

  it("uses the injected strategy (not DefaultScoringStrategy implicitly)", async () => {
    const fakeBreakdown: ScoreBreakdown = {
      standing:   { pts: 0, max: 25, standing: null },
      signal:     { pts: 0, max: 30, type: null, detectedAt: null },
      engagement: { pts: 0, max: 30, count: 0, lastAt: null },
      tasks:      { pts: 0, max: 10, open: 0 },
      contact:    { pts: 0, max: 5,  hasPrimary: false },
      total:      42,
      computedAt: new Date().toISOString(),
    };
    const customStrategy: ScoringStrategy = {
      name: "test-custom",
      score: vi.fn().mockReturnValue(fakeBreakdown),
    };
    const repo = makeRepo({});
    const engine = new ScoringEngine(customStrategy, repo);

    const result = await engine.recompute(ORG, COMPANY);

    expect(customStrategy.score).toHaveBeenCalledWith(baseInputs);
    expect(result).toEqual(fakeBreakdown);
    expect(vi.mocked(repo.persistScore)).toHaveBeenCalledWith(
      ORG,
      COMPANY,
      42,
      fakeBreakdown,
    );
  });

  it("forwards orgId + companyId verbatim to the repository", async () => {
    const repo = makeRepo({});
    const engine = new ScoringEngine(new DefaultScoringStrategy(), repo);

    await engine.recompute(ORG, COMPANY);

    expect(vi.mocked(repo.getInputs)).toHaveBeenCalledWith(ORG, COMPANY);
    expect(vi.mocked(repo.persistScore)).toHaveBeenCalledWith(
      ORG,
      COMPANY,
      expect.any(Number),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// ScoringEngineFactory
// ---------------------------------------------------------------------------

describe("ScoringEngineFactory", () => {
  it("returns the same instance across calls", () => {
    ScoringEngineFactory.reset();
    const a = ScoringEngineFactory.getInstance();
    const b = ScoringEngineFactory.getInstance();
    expect(a).toBe(b);
    ScoringEngineFactory.reset();
  });

  it("setInstance() overrides the cached engine", () => {
    const custom = new ScoringEngine(
      new DefaultScoringStrategy(),
      makeRepo({}),
    );
    ScoringEngineFactory.setInstance(custom);
    expect(ScoringEngineFactory.getInstance()).toBe(custom);
    ScoringEngineFactory.reset();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefaultPricingCalculator, FixedPricingCalculator } from "@/lib/ai/pricing";

describe("DefaultPricingCalculator", () => {
  const calc = new DefaultPricingCalculator();

  it("computes cost for gpt-5-mini correctly", () => {
    // gpt-5-mini : 0.25 $/Mtok in, 2.00 $/Mtok out
    // 1000 in + 500 out → (1000/1e6)*0.25 + (500/1e6)*2 = 0.00025 + 0.001 = 0.00125 $ = 0.125 cents → round to 0
    expect(calc.calculate("gpt-5-mini", 1000, 500)).toBe(0);
    // 100_000 in + 50_000 out → (1e5/1e6)*0.25 + (5e4/1e6)*2 = 0.025 + 0.1 = 0.125 $ = 12.5 cents → 13
    expect(calc.calculate("gpt-5-mini", 100_000, 50_000)).toBe(13);
  });

  it("computes cost for claude-sonnet-4-5 correctly", () => {
    // 3.00 in, 15.00 out
    // 10_000 in + 1000 out → 0.03 + 0.015 = 0.045 $ = 4.5 cents → 5
    expect(calc.calculate("claude-sonnet-4-5", 10_000, 1000)).toBe(5);
  });

  it("returns 0 and warns for unknown model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(calc.calculate("unknown-model-9001", 10_000, 1000)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns 0 for zero tokens regardless of model", () => {
    expect(calc.calculate("gpt-5", 0, 0)).toBe(0);
  });
});

describe("FixedPricingCalculator", () => {
  it("returns the fixed cents value", () => {
    const calc = new FixedPricingCalculator(42);
    expect(calc.calculate("any-model", 999, 999)).toBe(42);
  });
});

describe("PricingCalculator suite cleanup", () => {
  beforeEach(() => {});
  afterEach(() => vi.restoreAllMocks());
  it("placeholder to ensure mocks are reset", () => {
    expect(true).toBe(true);
  });
});

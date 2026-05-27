/**
 * Token-to-cost calculator for the LLM subsystem.
 *
 * Pricing is centralized here so changes to vendor rates are a one-file edit.
 * Each Strategy receives a PricingCalculator via constructor injection, so
 * tests can pass a deterministic stub instead of the default table.
 */

/** Cost calculation in cents. Returns 0 + logs a warning when model is unknown. */
export interface PricingCalculator {
  calculate(model: string, tokensIn: number, tokensOut: number): number;
}

/** Rates expressed in USD per 1 million tokens (USD per Mtok). */
type Rate = { inPerMTok: number; outPerMTok: number };

/**
 * Current pricing as of sprint 07. Update when vendors change rates.
 * Sources :
 *   - OpenAI : https://openai.com/api/pricing/
 *   - Anthropic : https://www.anthropic.com/pricing
 */
const PRICING: Record<string, Rate> = {
  // OpenAI
  "gpt-5":       { inPerMTok: 1.25, outPerMTok: 10.00 },
  "gpt-5-mini":  { inPerMTok: 0.25, outPerMTok:  2.00 },
  "gpt-5-nano":  { inPerMTok: 0.05, outPerMTok:  0.40 },
  "gpt-4o":      { inPerMTok: 2.50, outPerMTok: 10.00 },
  "gpt-4o-mini": { inPerMTok: 0.15, outPerMTok:  0.60 },

  // Anthropic
  "claude-sonnet-4-5":  { inPerMTok: 3.00, outPerMTok: 15.00 },
  "claude-haiku-4-5":   { inPerMTok: 1.00, outPerMTok:  5.00 },
  "claude-opus-4-5":    { inPerMTok: 15.00, outPerMTok: 75.00 },
};

/**
 * Default implementation : USD prices from the PRICING table, converted to cents.
 *
 * We round HALF-UP to the nearest cent. Sub-cent costs round to 0 — that's
 * acceptable for accounting at MVP (most messages cost a fraction of a cent ;
 * aggregating across many calls in `llm_usage` still gives a meaningful total).
 */
export class DefaultPricingCalculator implements PricingCalculator {
  public calculate(model: string, tokensIn: number, tokensOut: number): number {
    const rate = PRICING[model];
    if (!rate) {
      // We don't throw — an unknown model shouldn't block message generation.
      // The 0 cost gets recorded so we can detect missing-rate cases in logs.
      console.warn(`[pricing] Unknown model "${model}" — falling back to costCents=0`);
      return 0;
    }

    const inputDollars  = (tokensIn  / 1_000_000) * rate.inPerMTok;
    const outputDollars = (tokensOut / 1_000_000) * rate.outPerMTok;
    const totalCents = (inputDollars + outputDollars) * 100;

    return Math.round(totalCents);
  }
}

/**
 * Tiny fixed-rate calculator for tests : always returns the same number
 * regardless of inputs. Useful when a test cares about wiring, not arithmetic.
 */
export class FixedPricingCalculator implements PricingCalculator {
  constructor(private readonly cents: number) {}

  public calculate(): number {
    return this.cents;
  }
}

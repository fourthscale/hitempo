import type { ScoringStrategy } from "../scoring-strategy";
import type { ScoringInputs, ScoreBreakdown } from "../scoring-types";

/**
 * The original hitempo scoring rules (sprint 06).
 *
 * Score = standing (0-25) + signal (0-30) + engagement (0-30)
 *       + open tasks (0-10) + primary contact (0-5), capped at 100.
 *
 * Recency bonuses :
 *   - signal      : +10 if detected within last 30 days
 *   - engagement  : +10 if last interaction within last 14 days
 *
 * Pure : no DB, no clock — `now` is injectable for deterministic tests.
 */
export class DefaultScoringStrategy implements ScoringStrategy {
  public readonly name = "default";

  // Recency windows. Kept as static so subclasses (e.g. a per-vertical tweak)
  // can extend `DefaultScoringStrategy` and override just these without
  // duplicating the formula.
  protected static readonly SIGNAL_RECENT_DAYS = 30;
  protected static readonly INTERACTION_RECENT_DAYS = 14;

  public score(inputs: ScoringInputs, now: Date = new Date()): ScoreBreakdown {
    // Standing : 0-25 pts (5 standing levels mapped linearly to 25 pts)
    const standingPts =
      inputs.standing != null
        ? Math.round((inputs.standing / 5) * 25)
        : 0;

    // Signal : 0-30 pts (20 base + 10 recency bonus)
    const hasSignal = inputs.signalType != null;
    const signalBase = hasSignal ? 20 : 0;
    const signalBonus =
      hasSignal &&
      inputs.signalDetectedAt != null &&
      daysSince(inputs.signalDetectedAt, now) <= DefaultScoringStrategy.SIGNAL_RECENT_DAYS
        ? 10
        : 0;
    const signalPts = signalBase + signalBonus;

    // Engagement : 0-30 pts (20 base, capped at 4 interactions × 5 + 10 recency)
    const interactionBase = Math.min(inputs.interactionCount, 4) * 5;
    const interactionBonus =
      inputs.lastInteractionAt != null &&
      daysSince(inputs.lastInteractionAt, now) <= DefaultScoringStrategy.INTERACTION_RECENT_DAYS
        ? 10
        : 0;
    const engagementPts = interactionBase + interactionBonus;

    // Open task : 0-10 pts (binary — having at least one open task is what matters)
    const taskPts = inputs.openTaskCount > 0 ? 10 : 0;

    // Primary contact defined : 0-5 pts
    const contactPts = inputs.hasPrimaryContact ? 5 : 0;

    const total = Math.min(
      standingPts + signalPts + engagementPts + taskPts + contactPts,
      100,
    );

    return {
      standing:   { pts: standingPts,   max: 25, standing: inputs.standing },
      signal:     { pts: signalPts,     max: 30, type: inputs.signalType, detectedAt: inputs.signalDetectedAt?.toISOString() ?? null },
      engagement: { pts: engagementPts, max: 30, count: inputs.interactionCount, lastAt: inputs.lastInteractionAt?.toISOString() ?? null },
      tasks:      { pts: taskPts,       max: 10, open: inputs.openTaskCount },
      contact:    { pts: contactPts,    max: 5,  hasPrimary: inputs.hasPrimaryContact },
      total,
      computedAt: now.toISOString(),
    };
  }
}

function daysSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
}

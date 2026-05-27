export type ScoringInputs = {
  standing: number | null;
  signalType: string | null;
  signalDetectedAt: Date | null;
  interactionCount: number;
  lastInteractionAt: Date | null;
  openTaskCount: number;
  hasPrimaryContact: boolean;
};

export type ScoreBreakdown = {
  standing:   { pts: number; max: 25; standing: number | null };
  signal:     { pts: number; max: 30; type: string | null; detectedAt: string | null };
  engagement: { pts: number; max: 30; count: number; lastAt: string | null };
  tasks:      { pts: number; max: 10; open: number };
  contact:    { pts: number; max: 5;  hasPrimary: boolean };
  total:      number;
  computedAt: string;
};

const SIGNAL_RECENT_DAYS = 30;
const INTERACTION_RECENT_DAYS = 14;

function daysSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
}

export function computeCompanyScore(
  inputs: ScoringInputs,
  now: Date = new Date(),
): ScoreBreakdown {
  // Standing: 0-25 pts
  const standingPts = inputs.standing != null
    ? Math.round((inputs.standing / 5) * 25)
    : 0;

  // Signal: 0-30 pts (20 base + 10 recency bonus)
  const hasSignal = inputs.signalType != null;
  const signalBase = hasSignal ? 20 : 0;
  const signalBonus = hasSignal && inputs.signalDetectedAt != null
    && daysSince(inputs.signalDetectedAt, now) <= SIGNAL_RECENT_DAYS
    ? 10 : 0;
  const signalPts = signalBase + signalBonus;

  // Engagement: 0-30 pts (20 base + 10 recency bonus)
  const interactionBase = Math.min(inputs.interactionCount, 4) * 5;
  const interactionBonus = inputs.lastInteractionAt != null
    && daysSince(inputs.lastInteractionAt, now) <= INTERACTION_RECENT_DAYS
    ? 10 : 0;
  const engagementPts = interactionBase + interactionBonus;

  // Open task: 0-10 pts
  const taskPts = inputs.openTaskCount > 0 ? 10 : 0;

  // Primary contact defined: 0-5 pts
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

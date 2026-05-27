/**
 * Shared scoring data shapes. Lives in its own module so both the strategy
 * interface and the engine can reference them without circular imports.
 */

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

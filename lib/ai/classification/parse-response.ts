/**
 * Pure parser for the classifier's JSON response.
 *
 * The LLM is instructed to return strict JSON, but we defend against :
 *   - markdown fences (```json ... ```)
 *   - leading/trailing chatter
 *   - missing fields / wrong types
 *   - labels outside the enum
 *
 * Returns a validated `ClassificationOutput` on success, or `null` on any
 * parse / validation failure. The caller decides what to do (we record it
 * as `unknown` with confidence 0 so the row still gets an `ai_processed_at`
 * and we don't retry indefinitely).
 */

import { isIntentLabel, type IntentLabel } from "./intent-labels";

export type ClassificationOutput = {
  label: IntentLabel;
  confidence: number;
  reasoning: string;
};

/** Strip a ```json ... ``` fence if present, then trim. */
function stripFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1]! : raw;
  return body.trim();
}

export function parseClassificationResponse(raw: string): ClassificationOutput | null {
  const cleaned = stripFences(raw);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;

  const obj = json as Record<string, unknown>;
  const label = obj.label;
  const confidenceRaw = obj.confidence;
  const reasoning = obj.reasoning;

  if (!isIntentLabel(label)) return null;

  const confidence =
    typeof confidenceRaw === "number"
      ? confidenceRaw
      : typeof confidenceRaw === "string"
        ? Number(confidenceRaw)
        : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }

  const reasoningStr = typeof reasoning === "string" ? reasoning.slice(0, 240) : "";

  return { label, confidence, reasoning: reasoningStr };
}

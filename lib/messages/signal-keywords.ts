import type { MessageLocale } from "./types";

/**
 * Per-signalType keyword stems used to color-highlight signal mentions in
 * generated messages.
 *
 * Matching is case-insensitive and substring-based — `rénovation` matches
 * `rénovations`, `rénover`, `rénové` because they all start with `rénov`.
 * We list explicit stems rather than building them programmatically to keep
 * the behavior obvious and the tests deterministic.
 *
 * Anything not in the map falls back to the raw `signalType` string.
 */
const KEYWORDS: Record<string, Record<MessageLocale, string[]>> = {
  renovation: {
    fr: ["rénov", "renov"],
    en: ["renov"],
  },
  opening: {
    fr: ["ouvertur", "ouverture", "ouvrir", "inaugurat"],
    en: ["opening", "open", "inaugurat"],
  },
  fundraising: {
    fr: ["levée de fonds", "levée", "financement", "investisseur"],
    en: ["fundraising", "funding", "raised", "investor"],
  },
  expansion: {
    fr: ["expansion", "agrandiss", "extension"],
    en: ["expansion", "expanding", "extension"],
  },
  rebranding: {
    fr: ["rebranding", "refonte", "nouvelle identité"],
    en: ["rebranding", "refresh"],
  },
};

/**
 * Returns the list of stems to highlight for a given signal type and locale.
 * If the signalType has no dedicated entry, the raw value is returned —
 * lets us light up even unknown signal types as long as the model mentioned
 * them verbatim.
 */
export function getSignalKeywords(
  signalType: string | null | undefined,
  locale: MessageLocale,
): string[] {
  if (!signalType) return [];
  const entry = KEYWORDS[signalType.toLowerCase()];
  if (!entry) return [signalType];
  return entry[locale] ?? [];
}

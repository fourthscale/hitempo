import type { MessageLocale } from "./types";

/**
 * Per-signalType keyword stems used to color-highlight signal mentions in
 * generated messages.
 *
 * Matching is case-insensitive and substring-based — `rénovation` matches
 * `rénovations`, `rénover`, `rénové` because they all start with `rénov`.
 * Each locale list aims for the *shortest distinct stems* : longer forms
 * that are already prefixed by another entry don't need to be listed since
 * the annotator does substring matching with longest-match-wins on overlap.
 *
 * Both accented and unaccented variants are kept where users routinely
 * type without accents (`rénov` + `renov`) — we don't normalize input.
 *
 * Anything not in the map falls back to the raw `signalType` string.
 */
const KEYWORDS: Record<string, Record<MessageLocale, string[]>> = {
  renovation: {
    fr: ["rénov", "renov"],
    en: ["renov"],
  },
  opening: {
    // "ouvertur" already covers "ouverture", "ouvertures"
    fr: ["ouvertur", "ouvrir", "inaugurat"],
    // "open" already covers "opening", "opens", "opened"
    en: ["open", "inaugurat"],
  },
  fundraising: {
    // Keep "levée de fonds" before "levée" so the longer phrase wins on overlap
    fr: ["levée de fonds", "levée", "financement", "investisseur"],
    // "fund" covers "fundraising", "funding"
    en: ["fund", "raised", "investor"],
  },
  expansion: {
    // "extension" is distinct (no overlap with "expansion")
    fr: ["expansion", "agrandiss", "extension"],
    // "expand" covers "expanding", "expansion"
    en: ["expand", "extension"],
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

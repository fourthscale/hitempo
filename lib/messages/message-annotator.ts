/**
 * Pure function that splits a generated message into annotated segments,
 * highlighting :
 *   - personalization variables (contact firstName/lastName, jobTitle, company name)
 *   - signal-related keywords (driven by `signalKeywords`)
 *
 * Output is an array the dialog renders with the right colored span per kind.
 *
 * Matching rules :
 *   - case-insensitive substring (no word boundaries — FR morphology makes
 *     stem-based matching nicer than strict word boundaries)
 *   - longest match wins on overlap (deterministic)
 *   - earliest position wins on ties
 *   - case of the matched text is preserved in the output
 */

export type AnnotatedSegment =
  | { kind: "plain"; text: string }
  | { kind: "personalize"; text: string }
  | { kind: "signal"; text: string };

export type AnnotationContext = {
  contactFirstName: string;
  contactLastName: string;
  contactJobTitle: string | null;
  companyName: string;
  signalKeywords: string[];
};

export function annotateMessage(
  text: string,
  ctx: AnnotationContext,
): AnnotatedSegment[] {
  if (text.length === 0) return [];

  const personalizeTerms = [
    ctx.contactFirstName,
    ctx.contactLastName,
    ctx.companyName,
    ...(ctx.contactJobTitle ? [ctx.contactJobTitle] : []),
  ].filter((s) => s && s.trim().length > 0);

  const signalTerms = ctx.signalKeywords.filter((s) => s && s.trim().length > 0);

  // Build a flat list of (term, kind) sorted longest-first so that when we
  // search forward, the longest stem wins at any given position.
  type Term = { needle: string; kind: "personalize" | "signal" };
  const terms: Term[] = [
    ...personalizeTerms.map((t) => ({ needle: t, kind: "personalize" as const })),
    ...signalTerms.map((t) => ({ needle: t, kind: "signal" as const })),
  ].sort((a, b) => b.needle.length - a.needle.length);

  if (terms.length === 0) {
    return text.length > 0 ? [{ kind: "plain", text }] : [];
  }

  const lower = text.toLowerCase();
  type Hit = { start: number; end: number; kind: "personalize" | "signal" };
  const hits: Hit[] = [];

  // Find ALL hits for every term. We'll dedupe by overlap afterwards.
  for (const { needle, kind } of terms) {
    const lowerNeedle = needle.toLowerCase();
    let from = 0;
    while (from <= lower.length - lowerNeedle.length) {
      const idx = lower.indexOf(lowerNeedle, from);
      if (idx === -1) break;
      hits.push({ start: idx, end: idx + lowerNeedle.length, kind });
      from = idx + lowerNeedle.length;
    }
  }

  if (hits.length === 0) {
    return [{ kind: "plain", text }];
  }

  // Resolve overlaps : sort by start asc, then length desc ; greedily accept
  // a hit only if it doesn't overlap with one already accepted.
  hits.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });
  const accepted: Hit[] = [];
  let cursor = -1;
  for (const h of hits) {
    if (h.start < cursor) continue; // overlaps last accepted
    accepted.push(h);
    cursor = h.end;
  }

  // Emit segments
  const segments: AnnotatedSegment[] = [];
  let pos = 0;
  for (const h of accepted) {
    if (h.start > pos) {
      segments.push({ kind: "plain", text: text.slice(pos, h.start) });
    }
    segments.push({ kind: h.kind, text: text.slice(h.start, h.end) });
    pos = h.end;
  }
  if (pos < text.length) {
    segments.push({ kind: "plain", text: text.slice(pos) });
  }

  return segments;
}

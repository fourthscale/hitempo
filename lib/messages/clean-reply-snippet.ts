/**
 * Cleans up a Gmail message snippet for display in our timeline :
 *
 *   1. Decodes HTML entities (`&gt;`, `&#39;`, `&amp;`, etc.) — Gmail's API
 *      returns these literal in `snippet`.
 *   2. Strips the quoted-history tail. Most clients prefix the original
 *      message with `>`/`>>` lines and intro lines like
 *      "Le 28 mai 2026 à 20:55, X a écrit :" / "On May 28 ..., X wrote:".
 *
 * Heuristic only — works for the major French + English email clients
 * (Apple Mail, Gmail web, Outlook, Thunderbird). Edge cases are tolerable
 * since the user always has the "Voir dans Gmail" deep link as a fallback.
 *
 * Pure function : safe to unit-test.
 */
export function cleanReplySnippet(raw: string): string {
  if (!raw) return raw;

  // 1. Decode HTML entities.
  let s = decodeHtmlEntities(raw);

  // 2. Strip on the earliest "quote intro" marker we recognize.
  const markers: RegExp[] = [
    // French — "Le 28 mai 2026 à 20:55, X a écrit :"
    /\bLe\s+\d{1,2}\s+\S+\s+\d{4}\s+à\s+\d{1,2}:\d{2},?\s+[^\n,]+\s+a\s+écrit\s*:/i,
    // English — "On May 28, 2026, at 8:55 PM, X wrote:" / "On May 28 ..."
    /\bOn\s+[A-Z][a-z]+\s+\d{1,2}.{0,40}\s+wrote\s*:/i,
    // German — "Am 28.05.2026 um 20:55 schrieb X:"
    /\bAm\s+\d{1,2}\.\d{1,2}\.\d{4}\s+um\s+\d{1,2}:\d{2}\s+schrieb\s+/i,
    // Generic line starting with `>` (Apple Mail trims often inserts a blank line + ">").
    /\n\s*>/,
  ];
  for (const re of markers) {
    const m = s.search(re);
    if (m > -1) {
      s = s.slice(0, m);
    }
  }

  // 3. Strip our own "Reply:" prefix if present (we add it elsewhere — keep
  //    the helper idempotent if used in either direction).
  s = s.replace(/^Reply:\s*/i, "").replace(/^Réponse\s*:\s*/i, "");

  return s.trim();
}

/**
 * Decodes the named + numeric HTML entities Gmail puts in `snippet`. We
 * intentionally don't use the platform DOMParser (server-only path) ; a
 * tiny named-entity map covers what we actually see.
 */
function decodeHtmlEntities(input: string): string {
  return input
    // Numeric : decimal (&#39;) + hex (&#xA0;)
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // Named entities — only the common ones that actually show up
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

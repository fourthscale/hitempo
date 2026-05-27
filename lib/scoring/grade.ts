/**
 * Map a raw 0-100 score to a letter grade for display.
 *
 * The thresholds (80/70/60) are placeholders for sprint 04.5; sprint 06 will
 * codify scoring rules and may shift these boundaries. Keeping the function
 * here so the call sites don't bake the logic in.
 */
export function scoreGrade(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

/**
 * Tailwind classes for the colored score badge, keyed by grade.
 * Emerald = A, lime = B, amber = C, slate = D / unscored.
 */
export function scoreBadgeClasses(score: number | null | undefined): string {
  const grade = scoreGrade(score);
  switch (grade) {
    case "A":
      return "bg-emerald-50 text-emerald-700";
    case "B":
      return "bg-lime-50 text-lime-700";
    case "C":
      return "bg-amber-50 text-amber-700";
    case "D":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-500";
  }
}

/**
 * Initials for an avatar — first letter of each word, max 2.
 */
export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 0) return "?";
  if (words.length === 1 && words[0]) {
    return words[0].slice(0, 2).toUpperCase();
  }
  const first = words[0]?.[0] ?? "";
  const last = words[words.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

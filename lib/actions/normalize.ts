/**
 * Helpers shared across Server Actions for shaping FormData → DB row.
 *
 * Forms encode "no value" as the empty string `""`. The DB schema models
 * the same fields as `nullable text` columns where the convention is to
 * store `null` rather than `""`. `emptyStringsToNull` walks the parsed
 * input and applies that conversion so the action body can hand the
 * result straight to Drizzle without per-column null-coalescing.
 *
 * Pure function : returns a new shallow-cloned object, never mutates.
 */

export function emptyStringsToNull<T extends Record<string, unknown>>(
  input: T,
): { [K in keyof T]: T[K] extends string ? T[K] | null : T[K] } {
  const out: Record<string, unknown> = { ...input };
  for (const key of Object.keys(out)) {
    if (out[key] === "") out[key] = null;
  }
  return out as { [K in keyof T]: T[K] extends string ? T[K] | null : T[K] };
}

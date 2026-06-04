/**
 * Centralized date formatter — every date displayed in the UI flows through
 * here. The single responsibility : wrap `Intl.DateTimeFormat` with the
 * caller's locale AND an explicit `timeZone`, so the same instant shows up
 * identically whether rendered on the Node server (TZ=UTC on Vercel) or in
 * the user's browser (TZ=whatever).
 *
 * Why centralized : without this, Server Components silently format in UTC
 * and Client Components in the browser TZ — same row, two different
 * displayed times. Bug magnet. A grep guard (see `scripts/lint-no-raw-intl.sh`
 * or eslint custom rule) keeps direct `Intl.DateTimeFormat` calls out of UI
 * code so this stays the only path.
 *
 * Storage model : every `timestamptz` column in Postgres is UTC ; we
 * convert to the user's TZ at the rendering boundary. The user's TZ comes
 * from `organization_members.timezone` (NOT NULL default `Europe/Paris`).
 * The cascade for entity-bound dates (contact / site / company / org) is
 * separate and lives in `lib/i18n/timezones.ts` — different concept.
 */

// Pure formatting helper — safe to use on both server and client. The TZ
// comes from getActiveOrg() on the server, from <TzProvider> / useUserTz()
// on the client.

export type FormatDateOptions = Intl.DateTimeFormatOptions & {
  /** IANA timezone (e.g. `"Europe/Paris"`). Required — the whole point of
   *  this helper. Falsy / invalid values default to `"UTC"` ; the caller
   *  should always pass a real value or there's no reason to use this
   *  helper at all. */
  timeZone: string;
};

/**
 * Format a `Date` (or ISO string) in the user's locale + timezone. The
 * default style is `dateStyle: "medium", timeStyle: "short"` — covers
 * "task due at" / "interaction occurred at" use cases. Override via
 * `options`.
 *
 * Returns the string. Never throws on bad input — falls back to an empty
 * string on null / undefined / invalid Date / unknown TZ so the UI doesn't
 * crash on dirty data.
 */
export function formatDateInTz(
  date: Date | string | number | null | undefined,
  locale: string,
  options: FormatDateOptions,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  const { timeZone, ...rest } = options;
  // Intl.DateTimeFormat rejects mixing `dateStyle`/`timeStyle` with
  // individual options (`day`, `month`, `hour`, ...). The caller decides
  // which mode they want ; we do NOT inject defaults so we don't trigger
  // that conflict. If `rest` is empty, fall back to medium date + short
  // time — typical "createdAt" / "occurredAt" display.
  const hasAnyOption = Object.keys(rest).length > 0;
  const baseOptions: Intl.DateTimeFormatOptions = hasAnyOption
    ? rest
    : { dateStyle: "medium", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(locale, {
      ...baseOptions,
      timeZone: timeZone || "UTC",
    }).format(d);
  } catch {
    // Unknown timezone (typo in DB row, frozen runtime). Last-resort
    // fallback : format in UTC. We don't expect this in practice — the
    // timezones in DB are validated against the runtime Intl set.
    try {
      return new Intl.DateTimeFormat(locale, { ...baseOptions, timeZone: "UTC" }).format(d);
    } catch {
      return d.toISOString();
    }
  }
}

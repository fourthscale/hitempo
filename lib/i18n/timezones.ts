/**
 * Timezone helpers — validation + a curated shortlist for select inputs.
 *
 * Storage convention : every TZ-bearing column on contact/site/company/org/
 * member stores a raw IANA timezone string (`"Europe/Paris"`). NULL on a leaf
 * means "inherit from the parent" — see `loadSchedulingContext` for the
 * cascade order. We use the runtime `Intl` API for validation rather than
 * shipping a ~600 KB timezone list ; the curated shortlist below is purely a
 * UX nicety so users don't have to type IANA strings from memory.
 */

/** True if `tz` is an IANA timezone the JS runtime understands. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    // `Intl.DateTimeFormat` throws `RangeError` on an unknown timeZone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shortlist surfaced in the timezone select. Ordered so French / European
 * options come first (L&G dogfood + the EMEA SMB wedge), then a handful of US
 * + APAC anchors for travellers / multi-region orgs. The select also offers
 * "Other" → free text, so anything missing here is still reachable.
 */
/**
 * Origin of a resolved timezone after walking the cascade
 * `contact → site → company → organization`. Used to label the contact /
 * company / site detail views : "Europe/Paris (héritée de l'entreprise)".
 */
export type TimezoneSource = "contact" | "site" | "company" | "organization";

export type ResolvedTimezone<S extends TimezoneSource = TimezoneSource> = {
  tz: string;
  source: S;
};

/**
 * Walk the cascade and return the first non-null TZ + where it came from.
 * `orgTz` is required (never null in DB — `organizations.timezone` has a
 * NOT NULL default `'Europe/Paris'`), so each variant always returns a value.
 *
 * Three variants, one per entity level, so each caller declares exactly the
 * fields it has and TypeScript narrows the `source` discriminant accordingly.
 */
export function resolveContactTimezone(layers: {
  contactTz: string | null;
  siteTz: string | null;
  companyTz: string | null;
  orgTz: string;
}): ResolvedTimezone {
  if (layers.contactTz) return { tz: layers.contactTz, source: "contact" };
  if (layers.siteTz) return { tz: layers.siteTz, source: "site" };
  if (layers.companyTz) return { tz: layers.companyTz, source: "company" };
  return { tz: layers.orgTz, source: "organization" };
}

export function resolveSiteTimezone(layers: {
  siteTz: string | null;
  companyTz: string | null;
  orgTz: string;
}): ResolvedTimezone<"site" | "company" | "organization"> {
  if (layers.siteTz) return { tz: layers.siteTz, source: "site" };
  if (layers.companyTz) return { tz: layers.companyTz, source: "company" };
  return { tz: layers.orgTz, source: "organization" };
}

export function resolveCompanyTimezone(layers: {
  companyTz: string | null;
  orgTz: string;
}): ResolvedTimezone<"company" | "organization"> {
  if (layers.companyTz) return { tz: layers.companyTz, source: "company" };
  return { tz: layers.orgTz, source: "organization" };
}

export const COMMON_TIMEZONES: ReadonlyArray<string> = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Lisbon",
  "Europe/Zurich",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Australia/Sydney",
  "UTC",
];

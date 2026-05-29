import type {
  LocalizedString,
  SequenceContactCtx,
  SequenceCompanyCtx,
  SequenceOrgCtx,
} from "./types";

/**
 * Resolves a `LocalizedString` to a concrete string for a given enrolment's
 * locale chain. Locale is data, not flow control : a single sequence serves
 * contacts of all languages, and per-step text picks the right variant here.
 *
 * Fallback chain, most-specific → least :
 *   contact.preferredLanguage → company.primaryLocale → org.defaultLocale
 *   → explicit `default` → any non-empty value → "".
 *
 * Pure function — no I/O, fully unit-testable.
 */
export function resolveLocalizedString(
  value: LocalizedString,
  ctx: {
    contact: Pick<SequenceContactCtx, "preferredLanguage">;
    company: Pick<SequenceCompanyCtx, "primaryLocale">;
    organization: Pick<SequenceOrgCtx, "defaultLocale">;
  },
): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const candidates: Array<string | undefined> = [
    value[ctx.contact.preferredLanguage],
    value[ctx.company.primaryLocale],
    value[ctx.organization.defaultLocale],
    value.default,
    Object.values(value).find((v) => typeof v === "string" && v.length > 0),
  ];

  return candidates.find((c) => typeof c === "string" && c.length > 0) ?? "";
}

/** True when the value carries no usable text for the given locale chain. */
export function isLocalizedStringEmpty(
  value: LocalizedString | null | undefined,
  ctx: Parameters<typeof resolveLocalizedString>[1],
): boolean {
  if (value == null) return true;
  return resolveLocalizedString(value, ctx).trim().length === 0;
}

import { z } from "zod";

/**
 * Contact kind + display-name resolution (sprint 10.8).
 *
 * A contact is either a real named `person` or a `generic` channel
 * (info@hotel.fr, switchboard number) where no person is known yet.
 * This module owns :
 *   - the Zod schemas enforcing the kind/name/channel invariants at the
 *     action layer (DB CHECK is the defense-in-depth backstop) ;
 *   - `resolveContactDisplayName`, the single source of truth for how a
 *     contact is labelled across the UI.
 */

export type ContactKind = "person" | "generic";

const contactRoleValues = [
  "decision_maker",
  "influencer",
  "user",
  "prescriber",
  "assistant",
  "other",
] as const;

/**
 * Shared scalar fields between person and generic. firstName/lastName are
 * validated per-kind by the refinements below.
 */
const sharedContactFields = {
  companyId: z.string().uuid(),
  siteId: z.string().uuid().optional().or(z.literal("")),
  jobTitle: z.string().max(150).optional().or(z.literal("")),
  role: z.enum(contactRoleValues).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  preferredLanguage: z.string().max(10).default("fr"),
  preferredChannel: z
    .enum(["email", "phone", "linkedin", "in_person"])
    .optional()
    .or(z.literal("")),
  relevance: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).max(5).nullable().optional(),
  ),
  status: z.string().max(50).optional(),
  notes: z.string().max(5000).optional().or(z.literal("")),
  ownerId: z.string().uuid().optional().or(z.literal("")),
};

/**
 * Builds the contact body schema (without `id`). Refined so that :
 *   - kind = 'person'  → firstName + lastName required (non-empty)
 *   - kind = 'generic' → names optional, but at least one of email / phone
 *
 * Returned as a single schema usable for both create and update (update
 * spreads an extra `id`). The refinement attaches errors to the offending
 * field so the form can surface them inline.
 */
export function buildContactBodySchema() {
  return z
    .object({
      kind: z.enum(["person", "generic"]).default("person"),
      firstName: z.string().max(100).optional().or(z.literal("")),
      lastName: z.string().max(100).optional().or(z.literal("")),
      ...sharedContactFields,
    })
    .superRefine((data, ctx) => {
      const hasFirst = !!data.firstName && data.firstName.trim() !== "";
      const hasLast = !!data.lastName && data.lastName.trim() !== "";
      const hasEmail = !!data.email && data.email.trim() !== "";
      const hasPhone = !!data.phone && data.phone.trim() !== "";

      if (data.kind === "person") {
        if (!hasFirst) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["firstName"],
            message: "first_name_required",
          });
        }
        if (!hasLast) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["lastName"],
            message: "last_name_required",
          });
        }
      } else {
        // generic
        if (!hasEmail && !hasPhone) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["email"],
            message: "channel_required",
          });
        }
      }
    });
}

export const contactBodySchema = buildContactBodySchema();

// ---------------------------------------------------------------------------
// Display-name resolution
// ---------------------------------------------------------------------------

/** Minimal shape needed to render a contact's display name. email / phone
 *  are used as the natural label for generic contacts. */
export type ContactNameParts = {
  kind?: ContactKind | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
};

/**
 * The single source of truth for how a contact is labelled across the UI.
 *
 * - person  → "First Last" (or whichever part exists ; falls back to
 *             email / phone defensively if somehow both names are null).
 * - generic → email, else phone, else the localized `genericFallback`
 *             (which should never actually show given the DB CHECK
 *             guarantees one channel).
 *
 * Deliberately locale-agnostic for the common path : a generic contact
 * shows its email (e.g. "info@hotelwestminster.com"), which reads
 * naturally as "this is a generic channel, not a person" and needs no
 * translation. `genericFallback` only matters as a last resort.
 */
export function resolveContactDisplayName(
  c: ContactNameParts,
  opts?: { genericFallback?: string },
): string {
  const fallback = opts?.genericFallback ?? "Contact";
  if (c.kind === "generic") {
    return c.email || c.phone || fallback;
  }
  // person (or null kind for legacy safety)
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email || c.phone || fallback;
}

/** True when the contact has no real personal name (generic channel). */
export function isGenericContact(c: { kind?: ContactKind | null }): boolean {
  return c.kind === "generic";
}

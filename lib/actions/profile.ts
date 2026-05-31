"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg, getCurrentUser } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { organizationMembers } from "@/db/schema";
import { GmailCredentialsServiceFactory } from "@/lib/gmail/gmail-credentials-service-factory";
import { isValidTimezone } from "@/lib/i18n/timezones";
import type { WorkPattern } from "@/lib/sequences/work-pattern";

const LOCALE_VALUES = ["fr", "en"] as const;

// ---------------------------------------------------------------------------
// Update display name (stored in auth user_metadata — global across orgs)
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

export async function updateProfileAction(formData: FormData) {
  const parsed = updateProfileSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) {
    redirect("/settings/profile?error=invalid_input");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    data: { firstName: parsed.data.firstName, lastName: parsed.data.lastName },
  });

  if (error) {
    redirect("/settings/profile?error=update_failed");
  }

  revalidatePath("/settings/profile");
  redirect("/settings/profile?saved=profile");
}

// ---------------------------------------------------------------------------
// Update preferred locale (stored per org-membership + drives the locale cookie)
// ---------------------------------------------------------------------------

const updateLocaleSchema = z.object({
  locale: z.enum(LOCALE_VALUES),
});

export async function updatePreferredLocaleAction(formData: FormData) {
  const parsed = updateLocaleSchema.safeParse({ locale: formData.get("locale") });
  if (!parsed.success) {
    redirect("/settings/profile?error=invalid_input");
  }

  const { user, membership } = await getCurrentOrg();

  await getDb()
    .update(organizationMembers)
    .set({ preferredLocale: parsed.data.locale })
    .where(
      and(
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.organizationId, membership.organizationId),
      ),
    );

  // Apply immediately — drives the next-intl locale resolution
  const cookieStore = await cookies();
  cookieStore.set("locale", parsed.data.locale, {
    httpOnly: false, // readable by client if needed
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/settings/profile");
  redirect("/settings/profile?saved=locale");
}

// ---------------------------------------------------------------------------
// Change password (in-app — does not sign the user out)
// ---------------------------------------------------------------------------

const updatePasswordSchema = z.object({
  password: z.string().min(6),
  confirmPassword: z.string().min(6),
});

export async function updatePasswordInAppAction(formData: FormData) {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success || parsed.data.password !== parsed.data.confirmPassword) {
    redirect("/settings/profile?error=invalid_password");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    redirect("/settings/profile?error=update_failed");
  }

  redirect("/settings/profile?saved=password");
}

// ---------------------------------------------------------------------------
// Update working schedule — timezone + per-day task quotas. Sequence engine
// uses these at task-creation time to pick a slot that respects the sale's
// IANA timezone and per-channel daily limits. Stored on
// `organization_members` (per-org : a sale can carry different quotas in
// different tenants), separate from the auth user metadata.
// Permissions : MVP allows the sale to edit their own row only. Cross-user
// editing by org admin / platform admin is intentionally deferred to a
// follow-up.
// ---------------------------------------------------------------------------

// "HH:MM" 24h. The slot finder reads these literally — invalid formats would
// silently produce broken windows, so we validate strictly here.
const timeOfDayRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeWindowSchema = z
  .object({
    start: z.string().regex(timeOfDayRegex),
    end: z.string().regex(timeOfDayRegex),
  })
  .refine((w) => w.start < w.end, { message: "end must be after start" });

const dayKeySchema = z.enum([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

// `z.partialRecord` (Zod v4) — Zod 4's `z.record(enum, v)` is exhaustive by
// design (requires every enum key in the input), which breaks any pattern that
// drops weekends. `partialRecord` is the v3-style optional-keys variant.
const workPatternSchema = z.partialRecord(dayKeySchema, z.array(timeWindowSchema).min(1));

const updateWorkScheduleSchema = z.object({
  timezone: z.string().trim().min(1).max(64),
  maxEmailsPerDay: z.coerce.number().int().min(0).max(1000),
  maxCallsPerDay: z.coerce.number().int().min(0).max(1000),
});

/** Parse the JSON-serialized work pattern from the hidden input. Returns
 *  `null` when the field is absent or every day is disabled — caller treats
 *  that as "use the default pattern". Throws-shape returned as discriminated
 *  union so the action can branch without a try/catch. */
function parseWorkPattern(raw: FormDataEntryValue | null):
  | { ok: true; value: WorkPattern | null }
  | { ok: false } {
  if (typeof raw !== "string" || raw.length === 0) return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  const validated = workPatternSchema.safeParse(parsed);
  if (!validated.success) return { ok: false };
  const cleaned = validated.data as WorkPattern;
  // Empty object → treat as null so the engine falls back to defaults.
  return { ok: true, value: Object.keys(cleaned).length === 0 ? null : cleaned };
}

/**
 * Discriminated result of `updateWorkScheduleAction`.
 *
 * Returned instead of thrown so the client form can decide what to do on
 * failure WITHOUT a full-page redirect — the global error modal is opened
 * via a soft `router.replace(?action_error=…)` from the form, preserving
 * the user's in-progress edits (TZ choice, work-pattern slots).
 */
export type WorkScheduleActionResult =
  | { ok: true }
  | { ok: false; code: "invalid_input" | "invalid_timezone" | "invalid_work_pattern" };

export async function updateWorkScheduleAction(
  formData: FormData,
): Promise<WorkScheduleActionResult> {
  const parsed = updateWorkScheduleSchema.safeParse({
    timezone: formData.get("timezone"),
    maxEmailsPerDay: formData.get("maxEmailsPerDay"),
    maxCallsPerDay: formData.get("maxCallsPerDay"),
  });
  if (!parsed.success) return { ok: false, code: "invalid_input" };

  if (!isValidTimezone(parsed.data.timezone)) {
    return { ok: false, code: "invalid_timezone" };
  }

  const pattern = parseWorkPattern(formData.get("workPattern"));
  if (!pattern.ok) return { ok: false, code: "invalid_work_pattern" };

  const { user, membership } = await getCurrentOrg();

  await getDb()
    .update(organizationMembers)
    .set({
      timezone: parsed.data.timezone,
      maxEmailsPerDay: parsed.data.maxEmailsPerDay,
      maxCallsPerDay: parsed.data.maxCallsPerDay,
      workPattern: pattern.value,
    })
    .where(
      and(
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.organizationId, membership.organizationId),
      ),
    );

  // Silent save. revalidatePath rerenders server data ; the form keeps its
  // own state since the client component never unmounts.
  revalidatePath("/settings/profile");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Disconnect Gmail (delete the user_gmail_credentials row)
// ---------------------------------------------------------------------------

export async function disconnectGmailAction() {
  const user = await getCurrentUser();
  await GmailCredentialsServiceFactory.getInstance().delete(user.id);
  revalidatePath("/settings/profile");
  redirect("/settings/profile?gmail=disconnected");
}

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
// Disconnect Gmail (delete the user_gmail_credentials row)
// ---------------------------------------------------------------------------

export async function disconnectGmailAction() {
  const user = await getCurrentUser();
  await GmailCredentialsServiceFactory.getInstance().delete(user.id);
  revalidatePath("/settings/profile");
  redirect("/settings/profile?gmail=disconnected");
}

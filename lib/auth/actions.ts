"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CURRENT_ORG_COOKIE, getCurrentContext } from "@/lib/auth/context";
import { getAdminDb } from "@/db/client";
import { platformAdminAudit } from "@/db/schema";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const emailSchema = z.object({
  email: z.string().email(),
});

const passwordSchema = z.object({
  password: z.string().min(6),
});

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function signInAction(formData: FormData) {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid_input");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    redirect("/login?error=invalid_credentials");
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(formData: FormData) {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/forgot-password?error=invalid_input");
  }

  const supabase = await createClient();
  // Fire-and-forget; we never reveal whether the email exists.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });

  redirect("/forgot-password?sent=1");
}

export async function updatePasswordAction(formData: FormData) {
  const parsed = passwordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    redirect("/reset-password?error=weak_password");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    redirect("/reset-password?error=session_expired");
  }

  // Sign out the recovery-scope session so the user must re-authenticate with
  // their fresh password. Forces an explicit "log in with the new credentials"
  // step instead of dropping them into the app on a token they got via email.
  await supabase.auth.signOut();
  redirect("/login?info=password_set");
}

const uuidSchema = z.string().uuid();

/**
 * Enter an org. Platform admins can enter any org; normal users can only
 * "enter" their own membership (no-op for them, but the action is safe).
 * Logs to platform_admin_audit when an admin crosses into a non-own org.
 */
export async function selectOrgAction(orgId: string) {
  const parsedOrg = uuidSchema.safeParse(orgId);
  if (!parsedOrg.success) {
    redirect("/admin/orgs");
  }

  const { user, membership, isPlatformAdmin } = await getCurrentContext();

  // Normal users can't switch — silently bounce. They MUST have a membership
  // (getCurrentContext guarantees it for non-admins), so .organizationId is safe.
  if (!isPlatformAdmin) {
    if (!membership || parsedOrg.data !== membership.organizationId) {
      redirect("/dashboard");
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_ORG_COOKIE, parsedOrg.data, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // one week
  });

  // Audit when a platform admin enters an org that isn't their own membership.
  // A pure platform admin (no membership) → every entry is cross-org → always audit.
  if (isPlatformAdmin) {
    const isCrossOrg = !membership || parsedOrg.data !== membership.organizationId;
    if (isCrossOrg) {
      try {
        await getAdminDb().insert(platformAdminAudit).values({
          userId: user.id,
          tableName: "organizations",
          rowId: parsedOrg.data,
          operation: "SELECT",
          organizationId: parsedOrg.data,
        });
      } catch (e) {
        // Best-effort: don't block the user just because audit logging failed.
        console.error("platform_admin_audit insert failed", e);
      }
    }
  }

  redirect("/dashboard");
}

export async function exitOrgAction() {
  const cookieStore = await cookies();
  cookieStore.delete(CURRENT_ORG_COOKIE);
  redirect("/admin/orgs");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getAdminDb } from "@/db/client";
import {
  organizations,
  organizationMembers,
  platformAdmins,
  platformAdminAudit,
} from "@/db/schema";
import { getCurrentContext } from "@/lib/auth/context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Every admin action runs through this gate. Throws if the current user is
 * not a platform admin — defense in depth, even if the page is also gated
 * by the /admin layout.
 */
async function requirePlatformAdmin() {
  const ctx = await getCurrentContext();
  if (!ctx.isPlatformAdmin) {
    throw new Error("forbidden_not_platform_admin");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAN_VALUES = ["trial", "starter", "pro", "business"] as const;
const LOCALE_VALUES = ["fr", "en"] as const;
const ROLE_VALUES = ["owner", "admin", "commercial", "viewer"] as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseSupportedLocales(raw: string | undefined): ("fr" | "en")[] {
  if (!raw) return ["fr", "en"];
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is "fr" | "en" => s === "fr" || s === "en");
  return parts.length > 0 ? parts : ["fr", "en"];
}

/**
 * Looks up an auth user by email. Returns the Supabase user if found, else null.
 * The Supabase admin API has no direct `getByEmail` ; we list and filter.
 */
async function findAuthUserByEmail(email: string) {
  const supabase = getSupabaseAdmin();
  // `listUsers` is paginated ; for our scale (<1k users) one page suffices.
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`list_users_failed: ${error.message}`);
  const target = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  return target ?? null;
}

/**
 * Invites a new auth user by email. Sends the Supabase invitation email
 * (magic link → password setup). Returns the newly created auth user.
 */
async function inviteAuthUser(
  email: string,
  metadata: { firstName?: string; lastName?: string },
) {
  const supabase = getSupabaseAdmin();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: {
      ...(metadata.firstName ? { firstName: metadata.firstName } : {}),
      ...(metadata.lastName ? { lastName: metadata.lastName } : {}),
    },
    redirectTo: `${siteUrl}/reset-password`,
  });
  if (error) throw new Error(`invite_failed: ${error.message}`);
  if (!data.user) throw new Error("invite_failed: no user returned");
  return data.user;
}

/**
 * Deletes the underlying Supabase auth user if they no longer have any reason
 * to exist : no org memberships and no platform_admin row.
 *
 * Called automatically by revoke / remove flows so we don't accumulate ghost
 * accounts that can log in but see only an error page.
 *
 * Returns true iff the user was actually deleted.
 */
async function deleteAuthUserIfOrphan(userId: string): Promise<boolean> {
  const db = getAdminDb();

  const stillMember = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
    columns: { userId: true },
  });
  if (stillMember) return false;

  const stillAdmin = await db.query.platformAdmins.findFirst({
    where: eq(platformAdmins.userId, userId),
    columns: { userId: true },
  });
  if (stillAdmin) return false;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    // Don't crash the parent action — log and let the admin handle stale rows
    // manually if needed. The orphan auth user is annoying but not corrupting.
    console.warn(`[admin] failed to delete orphan auth user ${userId}: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Returns the auth user matching this email, creating or refreshing as needed :
 *
 *   - User not found → invite (creates user + sends email).
 *   - User found, never confirmed → update metadata + regenerate an invite link
 *     so a fresh email is sent. Useful when the first attempt was made without
 *     name fields (or when the recipient lost the email).
 *   - User found and confirmed → update metadata only ; no email re-send because
 *     they already have a working login. Whatever role / privilege we layer on
 *     top via the caller (org membership, platform_admin, …) takes effect on
 *     their next request — the cycle "promote → revoke → promote again" works
 *     transparently because the auth user is never deleted.
 *
 * Metadata fields are overwritten with any non-empty value passed in — what
 * the admin typed in the form wins over stale values.
 */
async function getOrInviteAuthUser(
  email: string,
  metadata: { firstName?: string; lastName?: string },
) {
  const supabase = getSupabaseAdmin();
  const existing = await findAuthUserByEmail(email);

  if (!existing) {
    const fresh = await inviteAuthUser(email, metadata);
    return { user: fresh, invited: true as const, reinvited: false as const };
  }

  // Build the metadata patch — overwrite when caller provided a non-empty value.
  const currentMeta = (existing.user_metadata ?? {}) as Record<string, unknown>;
  const nextMeta = { ...currentMeta };
  let metaChanged = false;
  if (metadata.firstName && currentMeta.firstName !== metadata.firstName) {
    nextMeta.firstName = metadata.firstName;
    metaChanged = true;
  }
  if (metadata.lastName && currentMeta.lastName !== metadata.lastName) {
    nextMeta.lastName = metadata.lastName;
    metaChanged = true;
  }

  if (metaChanged) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      user_metadata: nextMeta,
    });
    if (error) throw new Error(`update_metadata_failed: ${error.message}`);
  }

  // Notify the user that something changed on their account.
  // - Unconfirmed user → regenerate invite link (covers "they lost the email"
  //   or "we added missing name fields and want a fresh attempt").
  // - Confirmed user → generate a magic-link so they get an email pulling
  //   them back to the app and see their new role / membership. This is the
  //   only signal hitempo emits on re-promote without a dedicated transactional
  //   email system.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  let reinvited = false;
  if (!existing.email_confirmed_at) {
    const { error } = await supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: `${siteUrl}/reset-password` },
    });
    if (error) throw new Error(`reinvite_failed: ${error.message}`);
    reinvited = true;
  } else {
    const { error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${siteUrl}/dashboard` },
    });
    if (error) {
      // Rate-limit hits land here — non-fatal, just log.
      console.warn(`[admin] magiclink for ${email} skipped: ${error.message}`);
    }
  }

  return {
    user: { ...existing, user_metadata: nextMeta },
    invited: false as const,
    reinvited,
  };
}

// ---------------------------------------------------------------------------
// Organizations CRUD
// ---------------------------------------------------------------------------

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80).optional().or(z.literal("")),
  plan: z.enum(PLAN_VALUES).optional(),
  defaultLocale: z.enum(LOCALE_VALUES).optional(),
  supportedLocales: z.string().optional().or(z.literal("")),
});

export async function createOrgAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = createOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");

  const d = parsed.data;
  const slug = d.slug && d.slug.length > 0 ? slugify(d.slug) : slugify(d.name);
  if (!slug) throw new Error("invalid_slug");

  const [row] = await getAdminDb()
    .insert(organizations)
    .values({
      name: d.name,
      slug,
      plan: d.plan ?? "trial",
      defaultLocale: d.defaultLocale ?? "fr",
      supportedLocales: parseSupportedLocales(d.supportedLocales),
    })
    .returning({ id: organizations.id });

  if (!row) throw new Error("create_org_failed");
  revalidatePath("/admin/orgs");
  redirect(`/admin/orgs/${row.id}`);
}

const updateOrgSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  plan: z.enum(PLAN_VALUES),
  defaultLocale: z.enum(LOCALE_VALUES),
  supportedLocales: z.string().optional().or(z.literal("")),
});

export async function updateOrgAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = updateOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const d = parsed.data;

  await getAdminDb()
    .update(organizations)
    .set({
      name: d.name,
      plan: d.plan,
      defaultLocale: d.defaultLocale,
      supportedLocales: parseSupportedLocales(d.supportedLocales),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, d.id));

  revalidatePath("/admin/orgs");
  revalidatePath(`/admin/orgs/${d.id}`);
  redirect(`/admin/orgs/${d.id}`);
}

const softDeleteOrgSchema = z.object({
  id: z.string().uuid(),
});

export async function softDeleteOrgAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = softDeleteOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");

  await getAdminDb()
    .update(organizations)
    .set({ deletedAt: new Date() })
    .where(eq(organizations.id, parsed.data.id));

  revalidatePath("/admin/orgs");
  redirect("/admin/orgs");
}

// ---------------------------------------------------------------------------
// Org members
// ---------------------------------------------------------------------------

const inviteMemberSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().trim().max(100).optional().or(z.literal("")),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  role: z.enum(ROLE_VALUES),
});

export async function inviteUserToOrgAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = inviteMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const d = parsed.data;

  const { user } = await getOrInviteAuthUser(d.email, {
    firstName: d.firstName || undefined,
    lastName: d.lastName || undefined,
  });

  // Check if membership already exists in this org.
  const existing = await getAdminDb().query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.organizationId, d.orgId),
      eq(organizationMembers.userId, user.id),
    ),
  });
  if (existing) throw new Error("already_member");

  await getAdminDb().insert(organizationMembers).values({
    organizationId: d.orgId,
    userId: user.id,
    role: d.role,
  });

  revalidatePath(`/admin/orgs/${d.orgId}`);
}

const updateMemberRoleSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(ROLE_VALUES),
});

export async function updateMemberRoleAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = updateMemberRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const d = parsed.data;

  await getAdminDb()
    .update(organizationMembers)
    .set({ role: d.role })
    .where(
      and(
        eq(organizationMembers.organizationId, d.orgId),
        eq(organizationMembers.userId, d.userId),
      ),
    );

  revalidatePath(`/admin/orgs/${d.orgId}`);
}

const removeMemberSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeMemberFromOrgAction(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = removeMemberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const d = parsed.data;

  await getAdminDb()
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, d.orgId),
        eq(organizationMembers.userId, d.userId),
      ),
    );

  // Clean up the auth user if this was their last hold on the system.
  await deleteAuthUserIfOrphan(d.userId);

  revalidatePath(`/admin/orgs/${d.orgId}`);
}

// ---------------------------------------------------------------------------
// Platform admins
// ---------------------------------------------------------------------------

const promoteAdminSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().max(100).optional().or(z.literal("")),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function promotePlatformAdminAction(formData: FormData) {
  const ctx = await requirePlatformAdmin();
  const parsed = promoteAdminSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const d = parsed.data;

  const { user } = await getOrInviteAuthUser(d.email, {
    firstName: d.firstName || undefined,
    lastName: d.lastName || undefined,
  });
  const db = getAdminDb();

  // Idempotent : if already admin, nothing happens (audit row still emitted
  // by the trigger on real INSERT only).
  await db
    .insert(platformAdmins)
    .values({
      userId: user.id,
      note: d.note || null,
      grantedBy: ctx.user.id,
    })
    .onConflictDoNothing({ target: platformAdmins.userId });

  revalidatePath("/admin/platform-admins");
}

const revokeAdminSchema = z.object({
  userId: z.string().uuid(),
});

export async function revokePlatformAdminAction(formData: FormData) {
  const ctx = await requirePlatformAdmin();
  const parsed = revokeAdminSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");
  const d = parsed.data;

  // Block self-revoke as a safety net : avoids the "I locked myself out"
  // scenario. Another admin must do it.
  if (d.userId === ctx.user.id) {
    throw new Error("cannot_revoke_self");
  }

  await getAdminDb()
    .delete(platformAdmins)
    .where(eq(platformAdmins.userId, d.userId));

  // Clean up the auth user if this was their last hold on the system.
  await deleteAuthUserIfOrphan(d.userId);

  revalidatePath("/admin/platform-admins");
}

// ---------------------------------------------------------------------------
// Read helpers consumed by the pages
// ---------------------------------------------------------------------------

export type OrgListRow = {
  id: string;
  slug: string;
  name: string;
  plan: "trial" | "starter" | "pro" | "business";
  createdAt: Date;
  deletedAt: Date | null;
};

export async function listOrgsForAdmin(includeDeleted = false): Promise<OrgListRow[]> {
  await requirePlatformAdmin();
  const where = includeDeleted ? undefined : isNull(organizations.deletedAt);
  const rows = await getAdminDb()
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      plan: organizations.plan,
      createdAt: organizations.createdAt,
      deletedAt: organizations.deletedAt,
    })
    .from(organizations)
    .where(where)
    .orderBy(asc(organizations.name));
  return rows;
}

export type OrgMember = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: "owner" | "admin" | "commercial" | "viewer";
  joinedAt: Date;
};

export async function getOrgWithMembers(orgId: string) {
  await requirePlatformAdmin();
  const db = getAdminDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return null;

  const memberRows = await db
    .select({
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      joinedAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, orgId));

  // Resolve auth users in bulk so we can show emails in the UI.
  const supabase = getSupabaseAdmin();
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const usersById = new Map(list.users.map((u) => [u.id, u]));

  const members: OrgMember[] = memberRows.map((m) => {
    const u = usersById.get(m.userId);
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    return {
      userId: m.userId,
      email: u?.email ?? null,
      firstName: typeof meta.firstName === "string" ? meta.firstName : null,
      lastName: typeof meta.lastName === "string" ? meta.lastName : null,
      role: m.role,
      joinedAt: m.joinedAt,
    };
  });

  return { org, members };
}

export type PlatformAdminRow = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  note: string | null;
  grantedBy: string | null;
  grantedByEmail: string | null;
  createdAt: Date;
};

export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  await requirePlatformAdmin();
  const db = getAdminDb();

  const rows = await db
    .select({
      userId: platformAdmins.userId,
      note: platformAdmins.note,
      grantedBy: platformAdmins.grantedBy,
      createdAt: platformAdmins.grantedAt,
    })
    .from(platformAdmins)
    .orderBy(asc(platformAdmins.grantedAt));

  // Resolve emails for both target users and granters.
  const supabase = getSupabaseAdmin();
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const usersById = new Map(list.users.map((u) => [u.id, u]));

  return rows.map((r) => {
    const target = usersById.get(r.userId);
    const granter = r.grantedBy ? usersById.get(r.grantedBy) : null;
    const meta = (target?.user_metadata ?? {}) as Record<string, unknown>;
    return {
      userId: r.userId,
      email: target?.email ?? null,
      firstName: typeof meta.firstName === "string" ? meta.firstName : null,
      lastName: typeof meta.lastName === "string" ? meta.lastName : null,
      note: r.note,
      grantedBy: r.grantedBy,
      grantedByEmail: granter?.email ?? null,
      createdAt: r.createdAt,
    };
  });
}

// Audit log accessor — useful but not surfaced in the UI at this sprint.
// Kept here so a future "/admin/audit" route can use it.
export async function listAdminAuditRecent(limit = 50) {
  await requirePlatformAdmin();
  const rows = await getAdminDb()
    .select()
    .from(platformAdminAudit)
    .orderBy(asc(platformAdminAudit.occurredAt))
    .limit(limit);
  return rows;
}

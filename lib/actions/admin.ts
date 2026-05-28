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
import { AuthUserServiceFactory } from "@/lib/auth/auth-user-service-factory";
import { AuthDeleteUserError } from "@/lib/auth/auth-errors";
import {
  AdminActionAlreadyMemberError,
  AdminActionCannotRevokeSelfError,
  AdminActionCreateOrgFailedError,
  AdminActionInvalidSlugError,
  AdminActionNotPlatformAdminError,
  InvalidInputError,
} from "./admin-action-errors";
import { wrapActionError } from "./wrap-action-error";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Every admin action runs through this gate. Throws if the current user is
 * not a platform admin — defense in depth, even if the page is also gated
 * by the /admin layout. The user-facing error code is surfaced via the
 * global modal (no full-page error boundary).
 */
async function requirePlatformAdmin() {
  const ctx = await getCurrentContext();
  if (!ctx.isPlatformAdmin) {
    throw new AdminActionNotPlatformAdminError();
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
 * Deletes the underlying Supabase auth user if they no longer have any reason
 * to exist : no org memberships and no platform_admin row.
 *
 * Called automatically by revoke / remove flows so we don't accumulate ghost
 * accounts that can log in but see only an error page.
 *
 * Returns true iff the user was actually deleted. Failures from the Auth
 * service are swallowed (logged) — the orphan auth user is annoying but
 * not corrupting, and the parent action shouldn't fail because of it.
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

  try {
    await AuthUserServiceFactory.getInstance().deleteById(userId);
    return true;
  } catch (err) {
    if (err instanceof AuthDeleteUserError) {
      console.warn(`[admin] ${err.message}`);
      return false;
    }
    throw err;
  }
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
  let targetId: string | undefined;
  await wrapActionError(async () => {
    await requirePlatformAdmin();
    const parsed = createOrgSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) throw new InvalidInputError(parsed.error);

    const d = parsed.data;
    const slug = d.slug && d.slug.length > 0 ? slugify(d.slug) : slugify(d.name);
    if (!slug) throw new AdminActionInvalidSlugError();

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

    if (!row) throw new AdminActionCreateOrgFailedError();
    targetId = row.id;
    revalidatePath("/admin/orgs");
  });
  if (targetId) redirect(`/admin/orgs/${targetId}`);
}

const updateOrgSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  plan: z.enum(PLAN_VALUES),
  defaultLocale: z.enum(LOCALE_VALUES),
  supportedLocales: z.string().optional().or(z.literal("")),
});

export async function updateOrgAction(formData: FormData) {
  let successId: string | undefined;
  await wrapActionError(async () => {
      await requirePlatformAdmin();
      const parsed = updateOrgSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) throw new InvalidInputError(parsed.error);
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
      successId = d.id;
    },
  );
  if (successId) redirect(`/admin/orgs/${successId}`);
}

const softDeleteOrgSchema = z.object({
  id: z.string().uuid(),
});

export async function softDeleteOrgAction(formData: FormData) {
  let didDelete = false;
  await wrapActionError(async () => {
      await requirePlatformAdmin();
      const parsed = softDeleteOrgSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) throw new InvalidInputError(parsed.error);

      await getAdminDb()
        .update(organizations)
        .set({ deletedAt: new Date() })
        .where(eq(organizations.id, parsed.data.id));

      revalidatePath("/admin/orgs");
      didDelete = true;
    },
  );
  if (didDelete) redirect("/admin/orgs");
}

// ---------------------------------------------------------------------------
// Org members
// ---------------------------------------------------------------------------

/**
 * Lightweight lookup used by the invite form to adapt its UI before submission.
 * Returns whether the email already has a Supabase auth account and whether it
 * is confirmed. Safe to call from client components — platform-admin-gated.
 */
export async function checkEmailForInviteAction(email: string): Promise<{
  status: "new" | "existing_confirmed" | "existing_pending";
  displayName: string;
}> {
  await requirePlatformAdmin();
  const parsed = z.string().email().safeParse(email.trim());
  if (!parsed.success) return { status: "new", displayName: "" };

  const user = await AuthUserServiceFactory.getInstance().findByEmail(parsed.data);
  if (!user) return { status: "new", displayName: "" };

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    [
      typeof meta.firstName === "string" ? meta.firstName : "",
      typeof meta.lastName === "string" ? meta.lastName : "",
    ]
      .filter(Boolean)
      .join(" ") ||
    user.email ||
    "";

  return {
    status: user.email_confirmed_at ? "existing_confirmed" : "existing_pending",
    displayName,
  };
}

const inviteMemberSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().trim().max(100).optional().or(z.literal("")),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  role: z.enum(ROLE_VALUES),
  preferredLocale: z.enum(LOCALE_VALUES).optional(),
});

export async function inviteUserToOrgAction(formData: FormData) {
  await wrapActionError(async () => {
      await requirePlatformAdmin();
      const parsed = inviteMemberSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) throw new InvalidInputError(parsed.error);
      const d = parsed.data;

      const outcome = await AuthUserServiceFactory.getInstance().getOrInviteOrRefresh(
        d.email,
        {
          firstName: d.firstName || undefined,
          lastName: d.lastName || undefined,
        },
      );
      const user = outcome.user;
      if (outcome.status === "noop" && outcome.warning) {
        console.warn(`[admin] magic-link skipped for ${d.email}: ${outcome.warning}`);
      }

      // Check if membership already exists in this org.
      const existing = await getAdminDb().query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.organizationId, d.orgId),
          eq(organizationMembers.userId, user.id),
        ),
      });
      if (existing) throw new AdminActionAlreadyMemberError(d.email);

      await getAdminDb().insert(organizationMembers).values({
        organizationId: d.orgId,
        userId: user.id,
        role: d.role,
        preferredLocale: d.preferredLocale ?? "fr",
      });

      revalidatePath(`/admin/orgs/${d.orgId}`);
    },
  );
}

const updateMemberRoleSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(ROLE_VALUES),
});

export async function updateMemberRoleAction(formData: FormData) {
  await wrapActionError(async () => {
      await requirePlatformAdmin();
      const parsed = updateMemberRoleSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) throw new InvalidInputError(parsed.error);
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
    },
  );
}

const removeMemberSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeMemberFromOrgAction(formData: FormData) {
  await wrapActionError(async () => {
      await requirePlatformAdmin();
      const parsed = removeMemberSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) throw new InvalidInputError(parsed.error);
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
    },
  );
}

const resendInvitationSchema = z.object({
  email: z.string().email(),
  /** Optional — when set, only that page is revalidated ; otherwise both are. */
  orgId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * Re-sends an invitation email to a user who hasn't accepted yet.
 * Used by both `/admin/orgs/[id]` (members) and `/admin/platform-admins`
 * lists for unconfirmed users.
 */
export async function resendInvitationAction(formData: FormData) {
  await wrapActionError(async () => {
      await requirePlatformAdmin();
      const parsed = resendInvitationSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) throw new InvalidInputError(parsed.error);
      const d = parsed.data;

      await AuthUserServiceFactory.getInstance().sendInviteLink(d.email);

      if (d.orgId) revalidatePath(`/admin/orgs/${d.orgId}`);
      revalidatePath("/admin/platform-admins");
    },
  );
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
  await wrapActionError(async () => {
    const ctx = await requirePlatformAdmin();
    const parsed = promoteAdminSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) throw new InvalidInputError(parsed.error);
    const d = parsed.data;

    const outcome = await AuthUserServiceFactory.getInstance().getOrInviteOrRefresh(
      d.email,
      {
        firstName: d.firstName || undefined,
        lastName: d.lastName || undefined,
      },
    );
    const user = outcome.user;
    if (outcome.status === "noop" && outcome.warning) {
      console.warn(`[admin] magic-link skipped for ${d.email}: ${outcome.warning}`);
    }
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
  });
}

const revokeAdminSchema = z.object({
  userId: z.string().uuid(),
});

export async function revokePlatformAdminAction(formData: FormData) {
  await wrapActionError(async () => {
    const ctx = await requirePlatformAdmin();
    const parsed = revokeAdminSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) throw new InvalidInputError(parsed.error);
    const d = parsed.data;

    // Block self-revoke as a safety net : avoids the "I locked myself out"
    // scenario. Another admin must do it.
    if (d.userId === ctx.user.id) {
      throw new AdminActionCannotRevokeSelfError();
    }

    await getAdminDb()
      .delete(platformAdmins)
      .where(eq(platformAdmins.userId, d.userId));

    // Clean up the auth user if this was their last hold on the system.
    await deleteAuthUserIfOrphan(d.userId);

    revalidatePath("/admin/platform-admins");
  });
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
  /** True iff the user has accepted their invite and confirmed their email. */
  isConfirmed: boolean;
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

  // Resolve auth users in bulk via the service — one paginated listUsers call.
  const usersById = await AuthUserServiceFactory.getInstance().bulkResolve(
    memberRows.map((m) => m.userId),
  );

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
      isConfirmed: Boolean(u?.email_confirmed_at),
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
  /** True iff the user has accepted their invite and confirmed their email. */
  isConfirmed: boolean;
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

  // Resolve emails for both target users and granters via one bulk call.
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.userId);
    if (r.grantedBy) ids.add(r.grantedBy);
  }
  const usersById = await AuthUserServiceFactory.getInstance().bulkResolve(
    Array.from(ids),
  );

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
      isConfirmed: Boolean(target?.email_confirmed_at),
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

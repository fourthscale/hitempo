import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/client";
import { organizationMembers, organizations, platformAdmins } from "@/db/schema";

export const CURRENT_ORG_COOKIE = "current_org_id";

/**
 * Returns the currently authenticated Supabase user, or redirects to /login.
 * Use inside Server Components within (app)/* and admin/*.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Resolves the membership row for the current user (with the org loaded).
 * Returns null if the user has no membership — this is normal for a pure
 * platform admin. Callers decide what to do (redirect, fallback, etc.).
 *
 * Pure data fetch: no side effects.
 */
async function fetchMembership(userId: string) {
  const db = getDb();
  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, userId),
    with: { organization: true },
  });
  return membership ?? null;
}

async function isPlatformAdminUser(userId: string) {
  const db = getDb();
  const row = await db.query.platformAdmins.findFirst({
    where: eq(platformAdmins.userId, userId),
    columns: { userId: true },
  });
  return Boolean(row);
}

/**
 * Returns the user, their membership, and their org.
 * - If the user has a membership: returns it.
 * - If no membership AND user is a platform admin: redirects to /admin/orgs.
 * - If no membership AND not a platform admin: throws (data integrity bug).
 *
 * Do NOT call this from `/admin/orgs` itself — you'd infinite-loop.
 */
export async function getCurrentOrg() {
  const user = await getCurrentUser();
  const membership = await fetchMembership(user.id);

  if (!membership) {
    if (await isPlatformAdminUser(user.id)) {
      redirect("/admin/orgs");
    }
    throw new Error(`User ${user.id} has no organization membership`);
  }

  return {
    user,
    membership,
    organization: membership.organization,
  };
}

/**
 * Extended context — adds isPlatformAdmin. Tolerates missing membership
 * for platform admins (membership/organization may be null).
 *
 * If the user is a "ghost" — authenticated but has neither an org membership
 * nor a platform_admin row — we treat the session as revoked : sign them out
 * and bounce to /login?error=revoked so they see a clear message rather than
 * an opaque thrown error.
 *
 * Safe to call from /admin/orgs (does not redirect on missing membership when admin).
 */
export async function getCurrentContext() {
  const user = await getCurrentUser();
  const [membership, isPlatformAdmin] = await Promise.all([
    fetchMembership(user.id),
    isPlatformAdminUser(user.id),
  ]);

  if (!membership && !isPlatformAdmin) {
    // Cookie-bound sign-out before the redirect, so we don't loop back into
    // an authenticated session that has no business being in the app.
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login?error=revoked");
  }

  return {
    user,
    membership, // may be null for pure platform admins
    organization: membership?.organization ?? null, // may be null for pure platform admins
    isPlatformAdmin,
  };
}

/**
 * Resolves the org the current user is scoped to right now.
 *
 * Normal user (1 membership): returns their membership's org. A tampered
 * `current_org_id` cookie is ignored.
 *
 * Platform admin path:
 *   - cookie set → fetch that org; isImpersonating=true if != own org id
 *   - no cookie + has own membership → use own org
 *   - no cookie + no membership → redirect to /admin/orgs
 */
export async function getActiveOrg() {
  const { user, membership, organization, isPlatformAdmin } = await getCurrentContext();
  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

  if (isPlatformAdmin && cookieOrgId) {
    const target = await getDb().query.organizations.findFirst({
      where: and(eq(organizations.id, cookieOrgId), isNull(organizations.deletedAt)),
    });
    if (target) {
      return {
        user,
        membership,
        ownOrganization: organization,
        activeOrganization: target,
        isPlatformAdmin: true,
        isImpersonating: organization?.id !== target.id,
      };
    }
    // Cookie points to a non-existent org → ignore and fall through.
  }

  // No cookie path
  if (organization) {
    return {
      user,
      membership,
      ownOrganization: organization,
      activeOrganization: organization,
      isPlatformAdmin,
      isImpersonating: false,
    };
  }

  // Platform admin without any org context → must pick one.
  if (isPlatformAdmin) {
    redirect("/admin/orgs");
  }

  // Should be unreachable thanks to getCurrentContext's invariant.
  throw new Error("No active organization could be resolved");
}

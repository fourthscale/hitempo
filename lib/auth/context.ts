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
 * Fetches all memberships for a user (with orgs loaded) and returns the
 * full list plus the "active" one resolved by `preferredOrgId` (cookie).
 * Falls back to the first membership when the preferred id is absent or
 * doesn't match any of the user's orgs.
 */
async function resolveMemberships(userId: string, preferredOrgId?: string) {
  const db = getDb();
  const all = await db.query.organizationMembers.findMany({
    where: eq(organizationMembers.userId, userId),
    with: { organization: true },
  });

  if (all.length === 0) return { all: [], active: null };

  if (preferredOrgId) {
    const preferred = all.find((m) => m.organizationId === preferredOrgId);
    if (preferred) return { all, active: preferred };
  }

  return { all, active: all[0]! };
}

/**
 * Returns the list of org IDs the user is a member of.
 * Used by selectOrgAction to validate a switch target.
 */
export async function getUserOrgIds(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  return rows.map((r) => r.organizationId);
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
 * - If the user has a membership: returns it (cookie-resolved when multi-org).
 * - If no membership AND user is a platform admin: redirects to /admin/orgs.
 * - If no membership AND not a platform admin: throws (data integrity bug).
 *
 * Do NOT call this from `/admin/orgs` itself — you'd infinite-loop.
 */
export async function getCurrentOrg() {
  const user = await getCurrentUser();
  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
  const { active: membership } = await resolveMemberships(user.id, preferredOrgId);

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
  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

  const [{ all: allMemberships, active: membership }, isPlatformAdmin] = await Promise.all([
    resolveMemberships(user.id, preferredOrgId),
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
    membership,       // active membership (cookie-resolved when multi-org); null for pure platform admins
    allMemberships,   // all memberships — for the org switcher UI
    organization: membership?.organization ?? null,
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
  const { user, membership, allMemberships, organization, isPlatformAdmin } =
    await getCurrentContext();

  // Platform admins can impersonate any org via cookie (cross-org access).
  // The cookie is already factored in for regular multi-org users inside
  // getCurrentContext → resolveMemberships, so here we only need the extra
  // lookup for platform admins pointing at a non-member org.
  if (isPlatformAdmin) {
    const cookieStore = await cookies();
    const cookieOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;
    if (cookieOrgId) {
      const target = await getDb().query.organizations.findFirst({
        where: and(eq(organizations.id, cookieOrgId), isNull(organizations.deletedAt)),
      });
      if (target) {
        return {
          user,
          membership,
          allMemberships,
          ownOrganization: organization,
          activeOrganization: target,
          // userTimezone : the admin's own member-tz when they have one,
          // else the impersonated org's tz. Dates rendered for the admin
          // (createdAt rows, audit columns) feel right in their working
          // tz ; the impersonated org's tz is a sensible last-resort.
          userTimezone: membership?.timezone ?? target.timezone,
          isPlatformAdmin: true as const,
          isImpersonating: organization?.id !== target.id,
        };
      }
      // Cookie points to a non-existent org → fall through.
    }
  }

  if (organization) {
    return {
      user,
      membership,
      allMemberships,
      ownOrganization: organization,
      activeOrganization: organization,
      // userTimezone : `member.timezone` is NOT NULL (default Europe/Paris)
      // so `membership?.timezone` is always defined here. The `??`
      // fallback to organization.timezone handles the impossible-but-typed
      // case where membership is null (TypeScript can't narrow it here).
      userTimezone: membership?.timezone ?? organization.timezone,
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

import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { SidebarNav, type NavItem } from "./sidebar-nav";
import { Logo } from "./logo";
import { OrgSwitcher } from "./org-switcher";
import { signOutAction } from "@/lib/auth/actions";
import { LogOut, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { countCompaniesByOrg } from "@/db/queries/companies";
import { countContactsByOrg } from "@/db/queries/contacts";
import { countPendingTasksByOrg } from "@/db/queries/tasks";

type Organization = {
  id: string;
  name: string;
  slug: string;
};

type OrgOption = { id: string; name: string };

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return "?";
  const [local] = email.split("@");
  if (!local) return "?";
  const parts = local.split(/[._-]/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export async function Sidebar({
  user,
  organization,
  allOrgs = [],
  memberRole = null,
  isPlatformAdmin = false,
  showBusinessNav = true,
}: {
  user: User;
  organization: Organization | null;
  /** All orgs the user is a member of — drives the org switcher. */
  allOrgs?: OrgOption[];
  /** Role in the active org — displayed below the user name. */
  memberRole?: string | null;
  isPlatformAdmin?: boolean;
  /**
   * When false, only the chrome (logo, admin pill, user info, sign out) shows.
   * Use for screens that aren't scoped to an org (e.g. /admin/orgs).
   */
  showBusinessNav?: boolean;
}) {
  const t = await getTranslations("nav");
  const tRoles = await getTranslations("admin.orgs.detail.roles");

  // Real counters when we have an active org; skip otherwise (pure platform admin).
  const [companiesCount, contactsCount, tasksCount] = organization
    ? await Promise.all([
        countCompaniesByOrg(organization.id),
        countContactsByOrg(organization.id),
        countPendingTasksByOrg(organization.id, user.id),
      ])
    : [0, 0, 0];

  const items: NavItem[] = [
    { href: "/dashboard", label: t("dashboard"), icon: "dashboard" },
    { href: "/companies", label: t("companies"), icon: "companies", count: companiesCount },
    { href: "/contacts", label: t("contacts"), icon: "contacts", count: contactsCount },
    { href: "/tasks", label: t("tasks"), icon: "tasks", count: tasksCount },
    { href: "/sequences", label: t("sequences"), icon: "sequences" },
    { href: "/field", label: t("field"), icon: "field" },
    { href: "/messages", label: t("messagesNav"), icon: "messages" },
    { href: "/reporting", label: t("reporting"), icon: "reporting" },
    { href: "/settings", label: t("settings"), icon: "settings" },
  ];

  const initials = initialsFromEmail(user.email);
  const localPart = user.email?.split("@")[0] ?? "";
  const displayName = localPart.charAt(0).toUpperCase() + localPart.slice(1);

  return (
    <aside className="w-60 bg-sidebar text-sidebar-foreground flex flex-col py-5 shrink-0 sticky top-0 h-screen self-start overflow-y-auto">
      <div className="px-5 mb-6">
        <Logo variant="white" className="h-10 w-auto" />
        {organization && allOrgs.length > 1 ? (
          <OrgSwitcher orgs={allOrgs} activeOrgId={organization.id} />
        ) : organization ? (
          <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/60 mt-2">
            {organization.name}
          </div>
        ) : null}
        {isPlatformAdmin && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-brand-amber/15 text-brand-amber border border-brand-amber/30">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-amber" aria-hidden />
            Platform admin
          </div>
        )}
      </div>

      <div className="px-3 flex-1">
        {showBusinessNav && <SidebarNav items={items} />}
      </div>

      {isPlatformAdmin && (
        <div className="px-3 mt-2 mb-1 space-y-0.5">
          <Link
            href="/admin/orgs"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
            <span className="flex-1 truncate">{t("switchOrg")}</span>
          </Link>
          <Link
            href="/admin/platform-admins"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
            <span className="flex-1 truncate">{t("platformAdmins")}</span>
          </Link>
        </div>
      )}

      <div className="px-3 mt-4 pt-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2">
          <Link
            href="/settings/profile"
            className="flex items-center gap-3 min-w-0 flex-1 rounded-md hover:bg-sidebar-accent transition-colors -mx-2 px-2 py-1.5"
          >
            <div className="h-9 w-9 shrink-0 rounded-full bg-brand-amber/90 text-white flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white truncate">
                {displayName}
              </div>
              {memberRole && (
                <div className="text-xs text-sidebar-foreground/60 truncate">
                  {tRoles(memberRole as Parameters<typeof tRoles>[0])}
                </div>
              )}
            </div>
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-accent-foreground transition-colors"
              aria-label={t("signOut")}
              title={t("signOut")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

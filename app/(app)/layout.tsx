import { getActiveOrg } from "@/lib/auth/context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { ActionErrorModal } from "@/components/app/action-error-modal";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, activeOrganization, allMemberships, isPlatformAdmin, isImpersonating } =
    await getActiveOrg();

  return (
    <AppShell
      sidebar={
        <Sidebar
          user={user}
          organization={activeOrganization}
          allOrgs={allMemberships.map((m) => ({ id: m.organizationId, name: m.organization.name }))}
          isPlatformAdmin={isPlatformAdmin}
        />
      }
    >
      {isImpersonating && (
        <ImpersonationBanner orgName={activeOrganization.name} />
      )}
      <Topbar />
      <main className="flex-1 px-4 md:px-8 py-6 md:py-8 bg-background overflow-x-hidden">
        {children}
      </main>
      <ActionErrorModal />
    </AppShell>
  );
}

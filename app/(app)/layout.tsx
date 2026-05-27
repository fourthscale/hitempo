import { getActiveOrg } from "@/lib/auth/context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, activeOrganization, isPlatformAdmin, isImpersonating } =
    await getActiveOrg();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={user}
        organization={activeOrganization}
        isPlatformAdmin={isPlatformAdmin}
      />
      <div className="flex flex-col flex-1 min-w-0">
        {isImpersonating && (
          <ImpersonationBanner orgName={activeOrganization.name} />
        )}
        <Topbar />
        <main className="flex-1 px-8 py-8 bg-background overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

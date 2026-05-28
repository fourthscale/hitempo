import { redirect } from "next/navigation";
import { getCurrentContext } from "@/lib/auth/context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { ActionErrorModal } from "@/components/app/action-error-modal";
import { AppShell } from "@/components/app/app-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use getCurrentContext (does NOT redirect to /admin/orgs on missing membership
  // when the user is a platform admin) — otherwise we'd infinite-loop here.
  const { user, organization, isPlatformAdmin } = await getCurrentContext();
  if (!isPlatformAdmin) redirect("/dashboard");

  return (
    <AppShell
      sidebar={
        <Sidebar
          user={user}
          organization={organization}
          isPlatformAdmin={true}
          showBusinessNav={false}
        />
      }
    >
      <Topbar />
      <main className="flex-1 px-4 md:px-8 py-6 md:py-8 bg-background overflow-x-hidden">
        {children}
      </main>
      <ActionErrorModal />
    </AppShell>
  );
}

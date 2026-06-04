import { redirect } from "next/navigation";
import { getCurrentContext } from "@/lib/auth/context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { ActionErrorModal } from "@/components/app/action-error-modal";
import { AppShell } from "@/components/app/app-shell";
import { TzProvider } from "@/lib/i18n/tz-context";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use getCurrentContext (does NOT redirect to /admin/orgs on missing membership
  // when the user is a platform admin) — otherwise we'd infinite-loop here.
  const { user, membership, organization, isPlatformAdmin } = await getCurrentContext();
  if (!isPlatformAdmin) redirect("/dashboard");

  // Admin's own member.tz when they have a membership ; else fall back
  // to the org they're scoped to ; else UTC. Admins-without-membership
  // are rare (bootstrap-only) — UTC is acceptable noise there.
  const userTimezone = membership?.timezone ?? organization?.timezone ?? "UTC";

  return (
    <TzProvider userTimezone={userTimezone}>
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
    </TzProvider>
  );
}

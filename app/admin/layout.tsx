import { redirect } from "next/navigation";
import { getCurrentContext } from "@/lib/auth/context";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

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
    <div className="flex min-h-screen">
      <Sidebar
        user={user}
        organization={organization}
        isPlatformAdmin={true}
        showBusinessNav={false}
      />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar />
        <main className="flex-1 px-8 py-8 bg-background overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

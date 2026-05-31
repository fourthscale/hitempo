import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/auth/context";
import { getSiteWithDetails } from "@/db/queries/sites";
import { updateSiteAction } from "@/lib/actions/sites";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { SiteForm } from "@/components/app/site-form";

/**
 * Edit form for a site. Reuses `SiteForm` in its prefilled "edit" mode —
 * the form renders a hidden `id` input so `updateSiteAction` knows which
 * row to update. On success the action redirects back to `/sites/[id]`.
 */
export default async function SiteEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization } = await getActiveOrg();
  const site = await getSiteWithDetails(activeOrganization.id, id);
  if (!site) notFound();

  const t = await getTranslations("pages.sites");

  return (
    <div className="max-w-[700px] mx-auto">
      <PageHeader
        title={t("editTitle")}
        subtitle={
          <Link href={`/sites/${site.id}`} className="text-sm text-muted-foreground hover:underline">
            {site.name} · {site.company.name}
          </Link>
        }
      />
      <Card className="p-6">
        <SiteForm
          action={updateSiteAction}
          companyId={site.company.id}
          submitLabel={t("updateSubmit")}
          initial={{
            id: site.id,
            name: site.name,
            type: site.type,
            addressLine1: site.addressLine1,
            postalCode: site.postalCode,
            city: site.city,
            country: site.country,
            timezone: site.timezone,
            isPrimary: site.isPrimary,
          }}
        />
      </Card>
    </div>
  );
}

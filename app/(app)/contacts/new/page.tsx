import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { asc, eq, isNull, and } from "drizzle-orm";
import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { listSitesByOrgWithCompany } from "@/db/queries/sites";
import { createContactAction } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/app/contact-form";
import { PageHeader } from "@/components/app/page-header";

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { activeOrganization } = await getActiveOrg();
  const { companyId: preselect } = await searchParams;
  const t = await getTranslations("pages.contacts");

  const [companyList, siteList] = await Promise.all([
    getDb()
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.organizationId, activeOrganization.id), isNull(companies.deletedAt)))
      .orderBy(asc(companies.name)),
    listSitesByOrgWithCompany(activeOrganization.id),
  ]);

  return (
    <div className="max-w-[800px] mx-auto">
      <PageHeader
        title={t("new")}
        right={
          <Link href="/contacts" className="text-sm text-muted-foreground hover:underline">
            ← {t("backToList")}
          </Link>
        }
      />
      <ContactForm
        action={createContactAction}
        submitLabel={t("createSubmit")}
        companies={companyList}
        sites={siteList}
        defaultCompanyId={preselect}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getActiveOrg } from "@/lib/auth/context";
import { getContactById } from "@/db/queries/contacts";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import { listSitesByOrgWithCompany } from "@/db/queries/sites";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { updateContactAction } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/app/contact-form";
import { PageHeader } from "@/components/app/page-header";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization } = await getActiveOrg();
  const contact = await getContactById(activeOrganization.id, id);
  if (!contact) notFound();

  const [companyList, siteList] = await Promise.all([
    getDb()
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.organizationId, activeOrganization.id), isNull(companies.deletedAt)))
      .orderBy(asc(companies.name)),
    listSitesByOrgWithCompany(activeOrganization.id),
  ]);

  const t = await getTranslations("pages.contacts");

  return (
    <div className="max-w-[800px] mx-auto">
      <PageHeader
        title={t("editTitle", { name: resolveContactDisplayName(contact) })}
        right={
          <Link href={`/contacts/${contact.id}`} className="text-sm text-muted-foreground hover:underline">
            ← {t("backToDetail")}
          </Link>
        }
      />
      <ContactForm
        action={updateContactAction}
        submitLabel={t("updateSubmit")}
        companies={companyList}
        sites={siteList}
        initial={contact}
      />
    </div>
  );
}

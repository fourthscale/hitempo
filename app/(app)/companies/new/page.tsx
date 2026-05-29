import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getActiveOrg } from "@/lib/auth/context";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { createCompanyAction } from "@/lib/actions/companies";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { CompanyForm } from "@/components/app/company-form";
import { PageHeader } from "@/components/app/page-header";

export default async function NewCompanyPage() {
  const { activeOrganization } = await getActiveOrg();
  const t = await getTranslations("pages.companies");

  const parentCandidates = await getDb()
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(
      and(eq(companies.organizationId, activeOrganization.id), isNull(companies.deletedAt)),
    )
    .orderBy(asc(companies.name));

  const owners = (await getOrgMembersWithNames(activeOrganization.id)).map((m) => ({
    id: m.userId,
    name: m.displayName,
  }));

  return (
    <div className="max-w-[800px] mx-auto">
      <PageHeader
        title={t("new")}
        right={
          <Link href="/companies" className="text-sm text-muted-foreground hover:underline">
            ← {t("backToList")}
          </Link>
        }
      />
      <CompanyForm
        action={createCompanyAction}
        submitLabel={t("createSubmit")}
        parentCandidates={parentCandidates}
        owners={owners}
      />
    </div>
  );
}

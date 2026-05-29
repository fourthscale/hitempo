import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { getActiveOrg } from "@/lib/auth/context";
import { getCompanyById } from "@/db/queries/companies";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { updateCompanyAction } from "@/lib/actions/companies";
import { getOrgMembersWithNames } from "@/db/queries/members";
import { CompanyForm } from "@/components/app/company-form";
import { PageHeader } from "@/components/app/page-header";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization } = await getActiveOrg();
  const company = await getCompanyById(activeOrganization.id, id);
  if (!company) notFound();

  // Exclude the company itself from parent candidates to prevent self-loop.
  // (Sprint 4.6 follow-up: also exclude descendants to prevent deeper cycles.)
  const parentCandidates = await getDb()
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, activeOrganization.id),
        isNull(companies.deletedAt),
        ne(companies.id, company.id),
      ),
    )
    .orderBy(asc(companies.name));

  const owners = (await getOrgMembersWithNames(activeOrganization.id)).map((m) => ({
    id: m.userId,
    name: m.displayName,
  }));

  const t = await getTranslations("pages.companies");

  return (
    <div className="max-w-[800px] mx-auto">
      <PageHeader
        title={t("editTitle", { name: company.name })}
        right={
          <Link href={`/companies/${company.id}`} className="text-sm text-muted-foreground hover:underline">
            ← {t("backToDetail")}
          </Link>
        }
      />
      <CompanyForm
        action={updateCompanyAction}
        submitLabel={t("updateSubmit")}
        initial={company}
        parentCandidates={parentCandidates}
        owners={owners}
      />
    </div>
  );
}

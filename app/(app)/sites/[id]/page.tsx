import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MapPin, Building2 } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { getSiteWithDetails } from "@/db/queries/sites";
import { setSitePrimaryContactAction } from "@/lib/actions/sites";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { activeOrganization } = await getActiveOrg();
  const site = await getSiteWithDetails(activeOrganization.id, id);
  if (!site) notFound();

  const t = await getTranslations("pages.sites");
  const tContacts = await getTranslations("pages.contacts");

  const addressBits = [
    site.addressLine1,
    site.addressLine2,
    [site.postalCode, site.city].filter(Boolean).join(" "),
    site.region,
    site.country,
  ]
    .filter(Boolean)
    .join("\n");

  const currentPrimary = site.primaryContactId
    ? site.contacts.find((c) => c.id === site.primaryContactId) ?? null
    : null;

  return (
    <div className="max-w-[1200px] mx-auto">
      <nav className="text-xs text-muted-foreground mb-4">
        <Link href="/companies" className="hover:text-foreground">{t("breadcrumbCompanies")}</Link>
        {" / "}
        <Link href={`/companies/${site.company.id}`} className="hover:text-foreground">
          {site.company.name}
        </Link>
        {" / "}
        <span className="text-foreground">{site.name}</span>
      </nav>

      <PageHeader
        title={site.name}
        subtitle={
          <span>
            <span className="capitalize">{site.type}</span>
            {site.isPrimary && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-brand-teal/15 text-brand-teal">
                {t("primary")}
              </span>
            )}
            {" · "}
            <Link href={`/companies/${site.company.id}`} className="text-brand-teal hover:underline">
              {site.company.name}
            </Link>
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6 min-w-0">
          <Card className="p-6">
            <h2 className="font-serif text-lg font-bold mb-4 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-brand-teal" />
              {t("addressTitle")}
            </h2>
            {addressBits ? (
              <pre className="text-sm font-sans whitespace-pre-wrap text-foreground">{addressBits}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noAddress")}</p>
            )}
          </Card>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-2xl font-bold">{tContacts("titleSection")}</h2>
              <Link href={`/contacts/new?companyId=${site.company.id}`}>
                <Button size="sm" variant="outline">
                  {tContacts("new")}
                </Button>
              </Link>
            </div>
            <Card className="p-0 overflow-hidden">
              {site.contacts.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {t("noContacts")}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-muted-foreground text-[11px] uppercase tracking-wider text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">{tContacts("columns.name")}</th>
                      <th className="px-4 py-3 font-medium">{tContacts("columns.role")}</th>
                      <th className="px-4 py-3 font-medium">{tContacts("columns.email")}</th>
                      <th className="px-4 py-3 font-medium">{t("primaryFlag")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {site.contacts.map((c) => (
                      <tr key={c.id} className="hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <Link href={`/contacts/${c.id}`} className="font-medium hover:text-brand-teal">
                            {c.firstName} {c.lastName}
                          </Link>
                          {c.jobTitle && (
                            <div className="text-xs text-muted-foreground">{c.jobTitle}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{c.role ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground break-all">
                          {c.email ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          {site.primaryContactId === c.id ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-brand-teal/15 text-brand-teal">
                              {t("primary")}
                            </span>
                          ) : (
                            <form action={setSitePrimaryContactAction}>
                              <input type="hidden" name="siteId" value={site.id} />
                              <input type="hidden" name="companyId" value={site.company.id} />
                              <input type="hidden" name="contactId" value={c.id} />
                              <Button type="submit" size="sm" variant="ghost" className="text-xs">
                                {t("setPrimary")}
                              </Button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-serif text-lg font-bold mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand-teal" />
              {t("siteInfo")}
            </h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">{t("type")}</dt>
                <dd className="capitalize">{site.type}</dd>
              </div>
              {site.standing != null && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">{t("standing")}</dt>
                  <dd>{"★".repeat(site.standing)}</dd>
                </div>
              )}
              {currentPrimary && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">{t("primaryContact")}</dt>
                  <dd>
                    <Link
                      href={`/contacts/${currentPrimary.id}`}
                      className="text-brand-teal hover:underline"
                    >
                      {currentPrimary.firstName} {currentPrimary.lastName}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
            {site.notes && (
              <>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-4 mb-1">
                  {t("notes")}
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{site.notes}</p>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

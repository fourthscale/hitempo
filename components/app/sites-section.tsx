import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { SiteForm } from "./site-form";
import { SitesAdd } from "./sites-add";
import { createSiteAction, deleteSiteAction } from "@/lib/actions/sites";

type Site = {
  id: string;
  name: string;
  type: string;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  country: string;
  isPrimary: boolean;
  standing: number | null;
  notes: string | null;
};

export async function SitesSection({
  companyId,
  sites,
}: {
  companyId: string;
  sites: Site[];
}) {
  const t = await getTranslations("pages.companies.sites");

  return (
    <section className="mt-2">
      <SitesAdd
        title={t("title")}
        addLabel={t("addNew")}
        cancelLabel={t("cancel")}
      >
        <SiteForm
          action={createSiteAction}
          companyId={companyId}
          submitLabel={t("addSubmit")}
        />
      </SitesAdd>

      <Card className="p-0 overflow-hidden">
        {sites.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t("columns.name")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.type")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.address")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.primary")}</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((s) => (
                <tr key={s.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/sites/${s.id}`} className="hover:text-brand-teal">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.type}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[s.addressLine1, s.postalCode, s.city].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{s.isPrimary ? "✓" : ""}</td>
                  <td className="px-4 py-3 text-right">
                    <form action={deleteSiteAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="companyId" value={companyId} />
                      <SubmitButton
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                      >
                        {t("delete")}
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}

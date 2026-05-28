import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload, User } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { listContactsByOrg } from "@/db/queries/contacts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function ContactsPage() {
  const { activeOrganization } = await getActiveOrg();
  const rows = await listContactsByOrg(activeOrganization.id);
  const t = await getTranslations("pages.contacts");
  const tNav = await getTranslations("nav");
  const tRole = await getTranslations("contactRole");
  const tStatus = await getTranslations("contactStatus");

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title={tNav("contacts")}
        subtitle={t("count", { count: rows.length })}
        right={
          <div className="flex items-center gap-2">
            <Link href="/settings/import">
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-1.5" />
                {t("importCsv")}
              </Button>
            </Link>
            <Link href="/contacts/new">
              <Button>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("new")}
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="p-0 overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={User}
            title={t("empty")}
            action={{ label: t("emptyAction"), href: "/contacts/new" }}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">{t("columns.name")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.company")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.role")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.email")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.relevance")}</th>
                <th className="px-4 py-3 font-medium">{t("columns.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ contact, companyName, companyId }) => (
                <tr key={contact.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link href={`/contacts/${contact.id}`} className="font-medium hover:text-brand-teal">
                      {contact.firstName} {contact.lastName}
                    </Link>
                    {contact.jobTitle && (
                      <div className="text-xs text-muted-foreground">{contact.jobTitle}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/companies/${companyId}`} className="text-muted-foreground hover:text-brand-teal">
                      {companyName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {contact.role
                      ? tRole(contact.role as Parameters<typeof tRole>[0])
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground break-all">{contact.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {contact.relevance ? "★".repeat(contact.relevance) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {tStatus(contact.status as Parameters<typeof tStatus>[0])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

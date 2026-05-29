import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Upload, User } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { listContactsByOrg } from "@/db/queries/contacts";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
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
          <>
          {/* Mobile / tablet portrait : cards */}
          <ul className="lg:hidden divide-y divide-border">
            {rows.map(({ contact, companyName, companyId }) => (
              <li key={contact.id} className="px-4 py-3 hover:bg-secondary/30">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="font-medium text-foreground hover:text-brand-teal"
                    >
                      {resolveContactDisplayName(contact)}
                    </Link>
                    {contact.jobTitle && (
                      <div className="text-xs text-muted-foreground">{contact.jobTitle}</div>
                    )}
                    <Link
                      href={`/companies/${companyId}`}
                      className="block text-xs text-muted-foreground hover:text-brand-teal mt-0.5 truncate"
                    >
                      {companyName}
                    </Link>
                  </div>
                  {contact.relevance != null && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {"★".repeat(contact.relevance)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {contact.role && (
                    <span className="px-1.5 py-0.5 rounded bg-secondary text-foreground">
                      {tRole(contact.role as Parameters<typeof tRole>[0])}
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                    {tStatus(contact.status as Parameters<typeof tStatus>[0])}
                  </span>
                  {contact.email && (
                    <span className="text-muted-foreground truncate">· {contact.email}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop : table */}
          <div className="hidden lg:block overflow-x-auto"><table className="w-full text-sm">
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
                      {resolveContactDisplayName(contact)}
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
          </table></div>
          </>
        )}
      </Card>
    </div>
  );
}

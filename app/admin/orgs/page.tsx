import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { listOrgsForAdmin } from "@/lib/actions/admin";
import { selectOrgAction } from "@/lib/auth/actions";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";

export default async function AdminOrgsPage() {
  const t = await getTranslations("admin.orgs");
  const orgs = await listOrgsForAdmin(false);

  return (
    <div className="max-w-[1200px] mx-auto">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        right={
          <Link href="/admin/orgs/new">
            <Button>
              <Plus className="h-4 w-4 mr-1.5" />
              {t("new")}
            </Button>
          </Link>
        }
      />

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium">{t("columns.name")}</th>
              <th className="px-4 py-3 font-medium">{t("columns.slug")}</th>
              <th className="px-4 py-3 font-medium">{t("columns.plan")}</th>
              <th className="px-4 py-3 font-medium">{t("columns.created")}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orgs.map((org) => {
              const enterOrg = selectOrgAction.bind(null, org.id);
              return (
                <tr key={org.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/admin/orgs/${org.id}`}
                      className="hover:text-brand-teal"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{org.slug}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{org.plan}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link href={`/admin/orgs/${org.id}`}>
                        <Button type="button" size="sm" variant="outline">
                          {t("open")}
                        </Button>
                      </Link>
                      <form action={enterOrg}>
                        <SubmitButton size="sm">
                          {t("select")}
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

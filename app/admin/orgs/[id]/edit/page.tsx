import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getOrgWithMembers, updateOrgAction } from "@/lib/actions/admin";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLAN_OPTIONS = ["trial", "starter", "pro", "business"] as const;
const LOCALE_OPTIONS = ["fr", "en"] as const;

export default async function AdminOrgEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getOrgWithMembers(id);
  if (!result) notFound();
  const { org } = result;

  const t = await getTranslations("admin.orgs.edit");
  const tCreate = await getTranslations("admin.orgs.create");

  return (
    <div className="max-w-[700px] mx-auto">
      <PageHeader title={`${t("title")} — ${org.name}`} subtitle={t("subtitle")} />

      <Card className="p-6">
        <form action={updateOrgAction} className="space-y-5">
          <input type="hidden" name="id" value={org.id} />

          <div className="space-y-1.5">
            <Label htmlFor="name">{tCreate("fields.name")}</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              defaultValue={org.name}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="plan">{tCreate("fields.plan")}</Label>
              <select
                id="plan"
                name="plan"
                defaultValue={org.plan}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {PLAN_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="defaultLocale">{tCreate("fields.defaultLocale")}</Label>
              <select
                id="defaultLocale"
                name="defaultLocale"
                defaultValue={org.defaultLocale}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {LOCALE_OPTIONS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supportedLocales">{tCreate("fields.supportedLocales")}</Label>
            <Input
              id="supportedLocales"
              name="supportedLocales"
              defaultValue={(org.supportedLocales ?? ["fr", "en"]).join(",")}
              maxLength={30}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Link href={`/admin/orgs/${org.id}`}>
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </Link>
            <Button type="submit">{t("submit")}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

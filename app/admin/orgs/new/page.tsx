import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createOrgAction } from "@/lib/actions/admin";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormFooter } from "@/components/app/form-footer";

const PLAN_OPTIONS = ["trial", "starter", "pro", "business"] as const;
const LOCALE_OPTIONS = ["fr", "en"] as const;

export default async function AdminOrgNewPage() {
  const t = await getTranslations("admin.orgs.create");

  return (
    <div className="max-w-[700px] mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="p-6">
        <form action={createOrgAction} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("fields.name")}</Label>
            <Input id="name" name="name" required maxLength={200} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">{t("fields.slug")}</Label>
            <Input id="slug" name="slug" maxLength={80} placeholder="leon-george" />
            <p className="text-xs text-muted-foreground">{t("fields.slugHint")}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="plan">{t("fields.plan")}</Label>
              <select
                id="plan"
                name="plan"
                defaultValue="trial"
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
              <Label htmlFor="defaultLocale">{t("fields.defaultLocale")}</Label>
              <select
                id="defaultLocale"
                name="defaultLocale"
                defaultValue="fr"
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
            <Label htmlFor="supportedLocales">{t("fields.supportedLocales")}</Label>
            <Input
              id="supportedLocales"
              name="supportedLocales"
              defaultValue="fr,en"
              maxLength={30}
            />
            <p className="text-xs text-muted-foreground">{t("fields.supportedLocalesHint")}</p>
          </div>

          <FormFooter>
            <Link href="/admin/orgs">
              <Button type="button" variant="ghost">
                {t("cancel")}
              </Button>
            </Link>
            <SubmitButton>{t("submit")}</SubmitButton>
          </FormFooter>
        </form>
      </Card>
    </div>
  );
}

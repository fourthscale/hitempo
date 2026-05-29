import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/auth/context";
import { createSequenceAndOpenAction } from "@/lib/actions/sequences";
import { BUILT_IN_TEMPLATES } from "@/lib/sequences/built-in-templates";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function NewSequencePage() {
  const { activeOrganization } = await getActiveOrg();
  const locale = activeOrganization.defaultLocale === "en" ? "en" : "fr";
  const t = await getTranslations("pages.sequences");

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title={t("create.title")} />

      <Card className="p-6">
        <form action={createSequenceAndOpenAction} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">{t("create.nameLabel")}</Label>
            <Input id="name" name="name" placeholder={t("create.namePlaceholder")} maxLength={120} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-1">{t("create.templateLabel")}</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:border-brand-teal/40">
                <input type="radio" name="templateSlug" value="" defaultChecked className="mt-1" />
                <span className="text-sm font-medium">{t("create.blank")}</span>
              </label>
              {BUILT_IN_TEMPLATES.map((tpl) => (
                <label
                  key={tpl.slug}
                  className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer hover:border-brand-teal/40"
                >
                  <input type="radio" name="templateSlug" value={tpl.slug} className="mt-1" />
                  <span>
                    <span className="block text-sm font-medium">{tpl.name[locale]}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {tpl.description[locale]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center justify-end gap-2">
            <Link href="/sequences">
              <Button type="button" variant="outline">
                {t("create.cancel")}
              </Button>
            </Link>
            <SubmitButton>{t("create.submit")}</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Sparkles, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

export default async function SettingsPage() {
  const tNav = await getTranslations("nav");
  const tPage = await getTranslations("pages.settings");

  return (
    <div className="max-w-[900px] mx-auto">
      <PageHeader title={tNav("settings")} subtitle={tPage("placeholder")} />

      <div className="grid gap-3">
        <Link
          href="/settings/brand"
          className="block group"
          aria-label={tPage("brandSectionLink")}
        >
          <Card className="p-5 transition-colors hover:border-brand-teal/60">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-9 w-9 rounded-md bg-brand-teal/10 text-brand-teal flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-medium text-foreground">
                    {tPage("brandSectionTitle")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {tPage("brandSectionDescription")}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 group-hover:text-brand-teal transition-colors" />
            </div>
          </Card>
        </Link>
      </div>
    </div>
  );
}

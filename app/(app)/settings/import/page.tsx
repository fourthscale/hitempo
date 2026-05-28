import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/app/page-header";
import { CsvImportCard } from "@/components/app/csv-import-card";
import { CSV_IMPORT_MODES } from "@/lib/imports/csv-importer";

/**
 * `/settings/import` — entry point for bulk CSV import.
 *
 * All 4 modes are fully interactive (upload → preview → commit) via
 * `CsvImportCard`. Each card embeds its own "Download template" link
 * pointing at `/api/import/template?mode=<mode>`.
 */
export default async function ImportSettingsPage() {
  const t = await getTranslations("pages.import");

  return (
    <div className="max-w-[900px] mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid gap-3">
        {CSV_IMPORT_MODES.map((mode) => (
          <CsvImportCard
            key={mode}
            mode={mode}
            title={t(`modes.${mode}.title`)}
            description={t(`modes.${mode}.description`)}
          />
        ))}
      </div>
    </div>
  );
}

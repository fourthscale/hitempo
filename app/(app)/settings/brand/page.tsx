import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/auth/context";
import { getBrandBrief } from "@/db/queries/brand";
import { updateBrandBriefAction } from "@/lib/actions/brand";
import { BrandBriefEditor } from "@/components/app/brand-brief-editor";
import { PageHeader } from "@/components/app/page-header";

export default async function BrandSettingsPage() {
  const { activeOrganization } = await getActiveOrg();
  const [brief, t] = await Promise.all([
    getBrandBrief(activeOrganization.id),
    getTranslations("pages.settings.brand"),
  ]);

  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <BrandBriefEditor
        initial={brief ?? {}}
        action={updateBrandBriefAction}
        labels={{
          tabs: { fr: t("tabFr"), en: t("tabEn") },
          fields: {
            positioning:          t("fields.positioning"),
            positioningHint:      t("fields.positioningHint"),
            toneOfVoice:          t("fields.toneOfVoice"),
            toneOfVoiceHint:      t("fields.toneOfVoiceHint"),
            forbiddenWords:       t("fields.forbiddenWords"),
            forbiddenWordsHint:   t("fields.forbiddenWordsHint"),
            signatureExpressions: t("fields.signatureExpressions"),
            signatureExpressionsHint: t("fields.signatureExpressionsHint"),
            valueProps:           t("fields.valueProps"),
            valuePropsHint:       t("fields.valuePropsHint"),
            proofPoints:          t("fields.proofPoints"),
            proofPointsHint:      t("fields.proofPointsHint"),
          },
          save: t("save"),
          saved: t("saved"),
          listPlaceholder: t("listPlaceholder"),
        }}
      />
    </div>
  );
}

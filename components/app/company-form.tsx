import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormFooter } from "@/components/app/form-footer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";

const RELATIONSHIP_TYPES = ["prospect", "client", "former_client", "prescriber", "partner"] as const;
const COMPANY_STATUSES = ["to_qualify", "to_contact", "to_follow_up", "qualified", "not_interested"] as const;
const COMPANY_LOCALES = ["fr", "en"] as const;
const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const;

type CompanyInitial = {
  id?: string;
  name?: string | null;
  legalName?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  relationshipType?: string | null;
  industry?: string | null;
  sizeEstimate?: string | null;
  standing?: number | null;
  primaryLocale?: string | null;
  status?: string | null;
  signalType?: string | null;
  signalSource?: string | null;
  notes?: string | null;
  parentId?: string | null;
};

export async function CompanyForm({
  action,
  submitLabel,
  initial,
  parentCandidates,
}: {
  action: (formData: FormData) => Promise<void> | void;
  submitLabel: string;
  initial?: CompanyInitial;
  /** Other companies in the same org that this company can have as parent.
   *  Should NOT include the current company itself (would create a cycle). */
  parentCandidates: { id: string; name: string }[];
}) {
  const [t, tRel, tStatus, tLang] = await Promise.all([
    getTranslations("pages.companies.fields"),
    getTranslations("companyRelationshipType"),
    getTranslations("companyStatus"),
    getTranslations("languageName"),
  ]);

  return (
    <Card className="p-6">
      <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {initial?.id && <input type="hidden" name="id" value={initial.id} />}

        <div className="md:col-span-2 flex flex-col gap-1">
          <Label htmlFor="name">{t("name")} *</Label>
          <Input id="name" name="name" required defaultValue={initial?.name ?? ""} maxLength={200} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="legalName">{t("legalName")}</Label>
          <Input id="legalName" name="legalName" defaultValue={initial?.legalName ?? ""} maxLength={200} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="industry">{t("industry")}</Label>
          <Input id="industry" name="industry" defaultValue={initial?.industry ?? ""} maxLength={100} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="websiteUrl">{t("website")}</Label>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            defaultValue={initial?.websiteUrl ?? ""}
            placeholder="https://"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="linkedinUrl">{t("linkedin")}</Label>
          <Input
            id="linkedinUrl"
            name="linkedinUrl"
            type="url"
            defaultValue={initial?.linkedinUrl ?? ""}
            placeholder="https://linkedin.com/company/..."
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="relationshipType">{t("relationshipType")}</Label>
          <select
            id="relationshipType"
            name="relationshipType"
            defaultValue={initial?.relationshipType ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {RELATIONSHIP_TYPES.map((v) => (
              <option key={v} value={v}>
                {tRel(v)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="sizeEstimate">{t("sizeEstimate")}</Label>
          <select
            id="sizeEstimate"
            name="sizeEstimate"
            defaultValue={initial?.sizeEstimate ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {COMPANY_SIZES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="standing">{t("standing")}</Label>
          <select
            id="standing"
            name="standing"
            defaultValue={initial?.standing?.toString() ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            <option value="1">★</option>
            <option value="2">★★</option>
            <option value="3">★★★</option>
            <option value="4">★★★★</option>
            <option value="5">★★★★★</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="primaryLocale">{t("primaryLocale")}</Label>
          <select
            id="primaryLocale"
            name="primaryLocale"
            defaultValue={initial?.primaryLocale ?? "fr"}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {COMPANY_LOCALES.map((v) => (
              <option key={v} value={v}>
                {tLang(v)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="status">{t("status")}</Label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "to_qualify"}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {COMPANY_STATUSES.map((v) => (
              <option key={v} value={v}>
                {tStatus(v)}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 flex flex-col gap-1">
          <Label htmlFor="parentId">{t("parent")}</Label>
          <select
            id="parentId"
            name="parentId"
            defaultValue={initial?.parentId ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("parentNone")}</option>
            {parentCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="signalType">{t("signalType")}</Label>
          <Input
            id="signalType"
            name="signalType"
            defaultValue={initial?.signalType ?? ""}
            maxLength={100}
            placeholder="renovation, fundraising, opening..."
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="signalSource">{t("signalSource")}</Label>
          <Input
            id="signalSource"
            name="signalSource"
            defaultValue={initial?.signalSource ?? ""}
            maxLength={200}
            placeholder="BFM Business, LinkedIn, etc."
          />
        </div>

        <div className="md:col-span-2 flex flex-col gap-1">
          <Label htmlFor="notes">{t("notes")}</Label>
          <Textarea id="notes" name="notes" defaultValue={initial?.notes ?? ""} rows={4} maxLength={5000} />
        </div>

        <FormFooter className="md:col-span-2">
          <SubmitButton>{submitLabel}</SubmitButton>
        </FormFooter>
      </form>
    </Card>
  );
}

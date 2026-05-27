import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";

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
  const t = await getTranslations("pages.companies.fields");

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
            <option value="prospect">Prospect</option>
            <option value="client">Client</option>
            <option value="former_client">Former client</option>
            <option value="prescriber">Prescriber</option>
            <option value="partner">Partner</option>
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
            <option value="1-10">1-10</option>
            <option value="11-50">11-50</option>
            <option value="51-200">51-200</option>
            <option value="201-500">201-500</option>
            <option value="501-1000">501-1000</option>
            <option value="1000+">1000+</option>
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
            <option value="fr">Français</option>
            <option value="en">English</option>
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
            <option value="to_qualify">to_qualify</option>
            <option value="to_contact">to_contact</option>
            <option value="to_follow_up">to_follow_up</option>
            <option value="qualified">qualified</option>
            <option value="not_interested">not_interested</option>
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

        <div className="md:col-span-2 flex justify-end gap-2 pt-2">
          <Button type="submit">{submitLabel}</Button>
        </div>
      </form>
    </Card>
  );
}

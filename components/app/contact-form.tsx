import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { CompanySiteSelects } from "./company-site-selects";

type ContactInitial = {
  id?: string;
  companyId?: string | null;
  siteId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  preferredLanguage?: string | null;
  preferredChannel?: string | null;
  relevance?: number | null;
  status?: string | null;
  notes?: string | null;
};

export async function ContactForm({
  action,
  submitLabel,
  companies,
  sites,
  initial,
  defaultCompanyId,
}: {
  action: (formData: FormData) => Promise<void> | void;
  submitLabel: string;
  companies: { id: string; name: string }[];
  sites: { id: string; name: string; companyId: string; companyName: string }[];
  initial?: ContactInitial;
  defaultCompanyId?: string;
}) {
  const t = await getTranslations("pages.contacts.fields");
  const selectedCompanyId = initial?.companyId ?? defaultCompanyId ?? "";
  const selectedSiteId = initial?.siteId ?? "";

  return (
    <Card className="p-6">
      <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {initial?.id && <input type="hidden" name="id" value={initial.id} />}

        <CompanySiteSelects
          companies={companies}
          sites={sites.map((s) => ({ id: s.id, name: s.name, companyId: s.companyId }))}
          labelCompany={t("company")}
          labelSite={t("site")}
          labelSiteNone={t("siteNone")}
          labelSiteUnavailable={t("siteUnavailable")}
          defaultCompanyId={selectedCompanyId}
          defaultSiteId={selectedSiteId}
        />

        <div className="flex flex-col gap-1">
          <Label htmlFor="firstName">{t("firstName")} *</Label>
          <Input id="firstName" name="firstName" required defaultValue={initial?.firstName ?? ""} maxLength={100} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="lastName">{t("lastName")} *</Label>
          <Input id="lastName" name="lastName" required defaultValue={initial?.lastName ?? ""} maxLength={100} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="jobTitle">{t("jobTitle")}</Label>
          <Input id="jobTitle" name="jobTitle" defaultValue={initial?.jobTitle ?? ""} maxLength={150} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="role">{t("role")}</Label>
          <select
            id="role"
            name="role"
            defaultValue={initial?.role ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            <option value="decision_maker">Decision maker</option>
            <option value="influencer">Influencer</option>
            <option value="user">User</option>
            <option value="prescriber">Prescriber</option>
            <option value="assistant">Assistant</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" defaultValue={initial?.phone ?? ""} maxLength={50} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="linkedinUrl">{t("linkedin")}</Label>
          <Input
            id="linkedinUrl"
            name="linkedinUrl"
            type="url"
            defaultValue={initial?.linkedinUrl ?? ""}
            placeholder="https://linkedin.com/in/..."
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="relevance">{t("relevance")}</Label>
          <select
            id="relevance"
            name="relevance"
            defaultValue={initial?.relevance?.toString() ?? ""}
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
          <Label htmlFor="preferredLanguage">{t("preferredLanguage")}</Label>
          <select
            id="preferredLanguage"
            name="preferredLanguage"
            defaultValue={initial?.preferredLanguage ?? "fr"}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="preferredChannel">{t("preferredChannel")}</Label>
          <select
            id="preferredChannel"
            name="preferredChannel"
            defaultValue={initial?.preferredChannel ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="linkedin">LinkedIn</option>
            <option value="in_person">In person</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="status">{t("status")}</Label>
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "to_contact"}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="to_contact">to_contact</option>
            <option value="to_follow_up">to_follow_up</option>
            <option value="qualified">qualified</option>
            <option value="not_interested">not_interested</option>
          </select>
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

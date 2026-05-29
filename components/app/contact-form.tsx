import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormFooter } from "@/components/app/form-footer";
import { Card } from "@/components/ui/card";
import { CompanySiteSelects } from "./company-site-selects";
import { ContactKindFields } from "./contact-kind-fields";

const CONTACT_ROLES = ["decision_maker", "influencer", "user", "prescriber", "assistant", "other"] as const;
const CONTACT_CHANNELS = ["email", "phone", "linkedin", "in_person"] as const;
const CONTACT_STATUSES = ["to_contact", "to_follow_up", "qualified", "not_interested"] as const;
const CONTACT_LOCALES = ["fr", "en"] as const;

type ContactInitial = {
  id?: string;
  kind?: "person" | "generic" | null;
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
  ownerId?: string | null;
};

export async function ContactForm({
  action,
  submitLabel,
  companies,
  sites,
  initial,
  defaultCompanyId,
  owners,
}: {
  action: (formData: FormData) => Promise<void> | void;
  submitLabel: string;
  companies: { id: string; name: string }[];
  sites: { id: string; name: string; companyId: string; companyName: string }[];
  initial?: ContactInitial;
  defaultCompanyId?: string;
  /** Org members ; sets an optional owner override (else inherits company owner). */
  owners: { id: string; name: string }[];
}) {
  const [t, tRole, tChannel, tStatus, tLang] = await Promise.all([
    getTranslations("pages.contacts.fields"),
    getTranslations("contactRole"),
    getTranslations("contactChannel"),
    getTranslations("contactStatus"),
    getTranslations("languageName"),
  ]);
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

        <ContactKindFields
          initialKind={initial?.kind ?? "person"}
          initialFirstName={initial?.firstName}
          initialLastName={initial?.lastName}
          initialJobTitle={initial?.jobTitle}
          initialRole={initial?.role}
          initialLinkedinUrl={initial?.linkedinUrl}
          roleOptions={CONTACT_ROLES.map((v) => ({ value: v, label: tRole(v) }))}
          labels={{
            kindLabel: t("kindLabel"),
            kindPerson: t("kindPerson"),
            kindGeneric: t("kindGeneric"),
            firstName: t("firstName"),
            lastName: t("lastName"),
            jobTitle: t("jobTitle"),
            role: t("role"),
            linkedin: t("linkedin"),
            genericHint: t("genericHint"),
          }}
        />

        <div className="flex flex-col gap-1">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" defaultValue={initial?.phone ?? ""} maxLength={50} />
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
            {CONTACT_LOCALES.map((v) => (
              <option key={v} value={v}>
                {tLang(v)}
              </option>
            ))}
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
            {CONTACT_CHANNELS.map((v) => (
              <option key={v} value={v}>
                {tChannel(v)}
              </option>
            ))}
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
            {CONTACT_STATUSES.map((v) => (
              <option key={v} value={v}>
                {tStatus(v)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="ownerId">{t("owner")}</Label>
          <select
            id="ownerId"
            name="ownerId"
            defaultValue={initial?.ownerId ?? ""}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("ownerInherit")}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
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

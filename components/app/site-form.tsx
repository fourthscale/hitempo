import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormFooter } from "@/components/app/form-footer";
import { COMMON_TIMEZONES } from "@/lib/i18n/timezones";

const SITE_TYPES = ["office", "hotel", "showroom", "store", "restaurant", "warehouse", "other"] as const;
const TZ_INHERIT = "";

type SiteInitial = {
  id?: string;
  name?: string | null;
  type?: string | null;
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  isPrimary?: boolean | null;
};

export async function SiteForm({
  action,
  companyId,
  submitLabel,
  initial,
}: {
  action: (formData: FormData) => Promise<void> | void;
  companyId: string;
  submitLabel: string;
  /** When set, the form renders as an edit form (hidden `id` field, prefilled values). */
  initial?: SiteInitial;
}) {
  const [t, tType] = await Promise.all([
    getTranslations("pages.companies.sites.fields"),
    getTranslations("siteType"),
  ]);

  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
      <input type="hidden" name="companyId" value={companyId} />
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="md:col-span-2 flex flex-col gap-1">
        <Label htmlFor="site-name">{t("name")} *</Label>
        <Input
          id="site-name"
          name="name"
          required
          maxLength={200}
          defaultValue={initial?.name ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-type">{t("type")}</Label>
        <select
          id="site-type"
          name="type"
          defaultValue={initial?.type ?? "office"}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          {SITE_TYPES.map((v) => (
            <option key={v} value={v}>
              {tType(v)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-country">{t("country")}</Label>
        <Input
          id="site-country"
          name="country"
          defaultValue={initial?.country ?? "FR"}
          maxLength={2}
        />
      </div>

      <div className="md:col-span-2 flex flex-col gap-1">
        <Label htmlFor="site-address">{t("address")}</Label>
        <Input
          id="site-address"
          name="addressLine1"
          maxLength={200}
          defaultValue={initial?.addressLine1 ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-postalCode">{t("postalCode")}</Label>
        <Input
          id="site-postalCode"
          name="postalCode"
          maxLength={20}
          defaultValue={initial?.postalCode ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-city">{t("city")}</Label>
        <Input
          id="site-city"
          name="city"
          maxLength={100}
          defaultValue={initial?.city ?? ""}
        />
      </div>

      <div className="md:col-span-2 flex flex-col gap-1">
        <Label htmlFor="site-timezone">{t("timezone")}</Label>
        <select
          id="site-timezone"
          name="timezone"
          defaultValue={initial?.timezone ?? TZ_INHERIT}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={TZ_INHERIT}>{t("timezoneInherit")}</option>
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
          {/* Preserve an exotic TZ not in the curated list (set via API/CSV). */}
          {initial?.timezone && !COMMON_TIMEZONES.includes(initial.timezone) ? (
            <option value={initial.timezone}>{initial.timezone}</option>
          ) : null}
        </select>
      </div>

      <div className="md:col-span-2 flex items-center gap-2 pt-1">
        <input
          type="checkbox"
          id="site-isPrimary"
          name="isPrimary"
          defaultChecked={initial?.isPrimary ?? false}
          className="h-4 w-4"
        />
        <Label htmlFor="site-isPrimary" className="cursor-pointer">{t("isPrimary")}</Label>
      </div>

      <FormFooter className="md:col-span-2">
        <SubmitButton>{submitLabel}</SubmitButton>
      </FormFooter>
    </form>
  );
}

import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export async function SiteForm({
  action,
  companyId,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void> | void;
  companyId: string;
  submitLabel: string;
}) {
  const t = await getTranslations("pages.companies.sites.fields");

  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
      <input type="hidden" name="companyId" value={companyId} />

      <div className="md:col-span-2 flex flex-col gap-1">
        <Label htmlFor="site-name">{t("name")} *</Label>
        <Input id="site-name" name="name" required maxLength={200} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-type">{t("type")}</Label>
        <select
          id="site-type"
          name="type"
          defaultValue="office"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="office">Office</option>
          <option value="hotel">Hotel</option>
          <option value="showroom">Showroom</option>
          <option value="store">Store</option>
          <option value="restaurant">Restaurant</option>
          <option value="warehouse">Warehouse</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-country">{t("country")}</Label>
        <Input id="site-country" name="country" defaultValue="FR" maxLength={2} />
      </div>

      <div className="md:col-span-2 flex flex-col gap-1">
        <Label htmlFor="site-address">{t("address")}</Label>
        <Input id="site-address" name="addressLine1" maxLength={200} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-postalCode">{t("postalCode")}</Label>
        <Input id="site-postalCode" name="postalCode" maxLength={20} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="site-city">{t("city")}</Label>
        <Input id="site-city" name="city" maxLength={100} />
      </div>

      <div className="md:col-span-2 flex items-center gap-2 pt-1">
        <input type="checkbox" id="site-isPrimary" name="isPrimary" className="h-4 w-4" />
        <Label htmlFor="site-isPrimary" className="cursor-pointer">{t("isPrimary")}</Label>
      </div>

      <div className="md:col-span-2 flex justify-end pt-2">
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

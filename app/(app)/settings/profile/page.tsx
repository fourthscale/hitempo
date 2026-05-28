import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentOrg } from "@/lib/auth/context";
import {
  updateProfileAction,
  updatePreferredLocaleAction,
  updatePasswordInAppAction,
} from "@/lib/actions/profile";
import { CheckCircle2, AlertCircle } from "lucide-react";

const LOCALE_OPTIONS = ["fr", "en"] as const;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { user, membership } = await getCurrentOrg();
  const { saved, error } = await searchParams;

  const t = await getTranslations("pages.settings.profile");
  const tRoles = await getTranslations("admin.orgs.detail.roles");
  const tLocales = await getTranslations("admin.orgs.detail.memberInvite.localeOptions");

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const firstName = typeof meta.firstName === "string" ? meta.firstName : "";
  const lastName = typeof meta.lastName === "string" ? meta.lastName : "";

  return (
    <div className="max-w-[700px] mx-auto">
      <PageHeader title={t("title")} subtitle={user.email ?? ""} />

      {saved && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{t(`saved.${saved}`)}</span>
        </div>
      )}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{t(`errors.${error}`)}</span>
        </div>
      )}

      {/* Identity */}
      <Card className="p-6 mb-6">
        <h2 className="font-serif text-base font-bold mb-4">{t("identityTitle")}</h2>
        <form action={updateProfileAction} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{t("firstName")}</Label>
              <Input id="firstName" name="firstName" defaultValue={firstName} maxLength={100} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{t("lastName")}</Label>
              <Input id="lastName" name="lastName" defaultValue={lastName} maxLength={100} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("email")}</Label>
            <Input value={user.email ?? ""} disabled readOnly />
            <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
          </div>
          <div className="flex justify-end">
            <SubmitButton size="sm">{t("saveIdentity")}</SubmitButton>
          </div>
        </form>
      </Card>

      {/* Role + locale */}
      <Card className="p-6 mb-6">
        <h2 className="font-serif text-base font-bold mb-4">{t("orgTitle")}</h2>
        <div className="mb-4 space-y-1.5">
          <Label>{t("role")}</Label>
          <Input
            value={tRoles(membership.role as Parameters<typeof tRoles>[0])}
            disabled
            readOnly
          />
          <p className="text-xs text-muted-foreground">{t("roleHint")}</p>
        </div>
        <form action={updatePreferredLocaleAction}>
          <div className="space-y-1.5">
            <Label htmlFor="locale">{t("preferredLocale")}</Label>
            <select
              id="locale"
              name="locale"
              defaultValue={membership.preferredLocale}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {LOCALE_OPTIONS.map((l) => (
                <option key={l} value={l}>{tLocales(l)}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end mt-4">
            <SubmitButton size="sm">{t("saveLocale")}</SubmitButton>
          </div>
        </form>
      </Card>

      {/* Password */}
      <Card className="p-6">
        <h2 className="font-serif text-base font-bold mb-4">{t("passwordTitle")}</h2>
        <form action={updatePasswordInAppAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("newPassword")}</Label>
            <Input id="password" name="password" type="password" minLength={6} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" minLength={6} required />
          </div>
          <div className="flex justify-end">
            <SubmitButton size="sm">{t("savePassword")}</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

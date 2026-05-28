import Link from "next/link";
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
  disconnectGmailAction,
} from "@/lib/actions/profile";
import { GmailCredentialsServiceFactory } from "@/lib/gmail/gmail-credentials-service-factory";
import { GmailIcon } from "@/components/app/gmail-icon";
import { CheckCircle2, AlertCircle, Mail } from "lucide-react";

const LOCALE_OPTIONS = ["fr", "en"] as const;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; gmail?: string }>;
}) {
  const { user, membership } = await getCurrentOrg();
  const { saved, error, gmail } = await searchParams;
  const gmailCreds = await GmailCredentialsServiceFactory.getInstance().getForUser(user.id);

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
      {gmail && gmail !== "connected" && gmail !== "disconnected" && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{t(`gmailErrors.${gmail}`)}</span>
        </div>
      )}
      {(gmail === "connected" || gmail === "disconnected") && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{t(`gmailSaved.${gmail}`)}</span>
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

      {/* Email d'envoi — Gmail OAuth */}
      <Card className="p-6 mb-6">
        <h2 className="font-serif text-base font-bold mb-1">{t("gmailTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t("gmailDescription")}</p>

        {gmailCreds ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/30 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Mail className="h-4 w-4 shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{gmailCreds.gmailAddress}</div>
                <div className="text-xs text-muted-foreground">
                  {t("gmailConnectedSince", {
                    date: new Date(gmailCreds.connectedAt).toLocaleDateString(),
                  })}
                </div>
              </div>
            </div>
            <form action={disconnectGmailAction}>
              <SubmitButton size="sm" variant="outline" className="text-red-600 hover:bg-red-50">
                {t("gmailDisconnect")}
              </SubmitButton>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <Link
              href="/api/auth/gmail/connect"
              className="inline-flex items-center gap-3 h-10 pl-3 pr-4 rounded-md bg-white border border-[#dadce0] text-[#3c4043] text-sm font-medium hover:shadow-md hover:bg-[#f8faff] transition-all"
            >
              <GmailIcon className="h-[18px] w-[18px] shrink-0" />
              <span>{t("gmailConnect")}</span>
            </Link>
            <p className="text-xs text-muted-foreground">{t("gmailScopeNotice")}</p>
          </div>
        )}
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


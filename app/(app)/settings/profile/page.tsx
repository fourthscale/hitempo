import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDateInTz } from "@/lib/i18n/format-date";
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
import { CheckCircle2, AlertCircle, Mail, RefreshCw } from "lucide-react";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { and, count, eq } from "drizzle-orm";
import { COMMON_TIMEZONES } from "@/lib/i18n/timezones";
import { WorkScheduleForm } from "@/components/app/work-schedule-form";
import type { WorkPattern } from "@/lib/sequences/work-pattern";

const LOCALE_OPTIONS = ["fr", "en"] as const;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    gmail?: string;
    gmail_replayed?: string;
  }>;
}) {
  const { user, membership, organization } = await getCurrentOrg();
  const { saved, error, gmail, gmail_replayed: gmailReplayedRaw } = await searchParams;
  const gmailCredsService = GmailCredentialsServiceFactory.getInstance();
  const [gmailCreds, gmailStatus, gmailAuthFailedTaskCount] = await Promise.all([
    gmailCredsService.getForUser(user.id),
    gmailCredsService.getConnectionStatus(user.id),
    // Count of agent tasks waiting for a Gmail reconnect — surfaces a
    // proactive "X tâches en attente" when the user lands on the page,
    // even before they hit "Reconnect Gmail".
    getDb()
      .select({ c: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, membership.organizationId),
          eq(tasks.assigneeId, user.id),
          eq(tasks.status, "pending"),
          eq(tasks.autoExecutionStatus, "failed"),
          eq(tasks.autoExecutionFailureKind, "gmail_auth"),
        ),
      )
      .then((rows) => rows[0]?.c ?? 0),
  ]);
  const gmailReplayed = Number(gmailReplayedRaw ?? 0);
  const isGmailRevoked = gmailStatus.status === "revoked";

  const locale = await getLocale();
  const t = await getTranslations("pages.settings.profile");
  const tRoles = await getTranslations("admin.orgs.detail.roles");
  const tLocales = await getTranslations("admin.orgs.detail.memberInvite.localeOptions");

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const firstName = typeof meta.firstName === "string" ? meta.firstName : "";
  const lastName = typeof meta.lastName === "string" ? meta.lastName : "";

  const memberTimezone = membership.timezone ?? organization.timezone;
  // Include the member's current TZ in the dropdown even if it's outside the
  // curated COMMON_TIMEZONES list — covers users who manually set an exotic
  // IANA value via the API or who have an inherited org TZ outside the
  // shortlist. Dedupe + sort so the rendered <option> set is stable.
  const tzChoices = Array.from(new Set([memberTimezone, ...COMMON_TIMEZONES])).sort();

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
      {gmail === "connected" && gmailReplayed > 0 && (
        // Sprint 14 — surface the post-reconnect replay outcome. Distinct
        // banner (different colour + icon) so the user reads both flashes :
        // "Gmail connected" AND "X tasks relaunched".
        <div className="mb-6 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800">
          <RefreshCw className="h-4 w-4 shrink-0" />
          <span>{t("gmailReplayed", { count: gmailReplayed })}</span>
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

      {/* Working schedule — TZ + per-day task quotas + work pattern */}
      <Card className="p-6 mb-6">
        <h2 className="font-serif text-base font-bold mb-1">{t("scheduleTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t("scheduleDescription")}</p>
        <WorkScheduleForm
          defaults={{
            timezone: memberTimezone,
            maxEmailsPerDay: membership.maxEmailsPerDay ?? 25,
            maxCallsPerDay: membership.maxCallsPerDay ?? 10,
            workPattern: membership.workPattern as WorkPattern | null,
          }}
          tzChoices={tzChoices}
        />
      </Card>

      {/* Email d'envoi — Gmail OAuth */}
      <Card className="p-6 mb-6">
        <h2 className="font-serif text-base font-bold mb-1">{t("gmailTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t("gmailDescription")}</p>

        {gmailCreds && isGmailRevoked ? (
          // Sprint 14 — credential row still exists but the refresh token
          // died. We show a clear amber-warning card with the diagnosis,
          // the date of death, and a prominent Reconnect CTA. The
          // Disconnect button stays available so the user can wipe the
          // credential entirely if they want to switch addresses.
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-amber-900">
                  {t("gmailRevokedTitle", { address: gmailCreds.gmailAddress })}
                </div>
                <div className="text-xs text-amber-800 mt-1">
                  {gmailStatus.revokedAt
                    ? t("gmailRevokedSince", {
                        date: formatDateInTz(gmailStatus.revokedAt, locale, {
                          timeZone: memberTimezone,
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })
                    : t("gmailRevokedGeneric")}
                </div>
                {gmailAuthFailedTaskCount > 0 && (
                  <div className="text-xs text-amber-800 mt-1">
                    {t("gmailRevokedTaskWaiting", { count: gmailAuthFailedTaskCount })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/api/auth/gmail/connect"
                className="inline-flex items-center gap-3 h-10 pl-3 pr-4 rounded-md bg-white border border-[#dadce0] text-[#3c4043] text-sm font-medium hover:shadow-md hover:bg-[#f8faff] transition-all"
              >
                <GmailIcon className="h-[18px] w-[18px] shrink-0" />
                <span>{t("gmailReconnect")}</span>
              </Link>
              <form action={disconnectGmailAction}>
                <SubmitButton size="sm" variant="outline" className="text-red-600 hover:bg-red-50">
                  {t("gmailDisconnect")}
                </SubmitButton>
              </form>
            </div>
          </div>
        ) : gmailCreds ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/30 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Mail className="h-4 w-4 shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{gmailCreds.gmailAddress}</div>
                <div className="text-xs text-muted-foreground">
                  {t("gmailConnectedSince", {
                    date: formatDateInTz(gmailCreds.connectedAt, locale, { timeZone: memberTimezone, dateStyle: "medium" }),
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


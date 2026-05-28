import { getTranslations, getLocale } from "next-intl/server";
import {
  listPlatformAdmins,
  promotePlatformAdminAction,
  resendInvitationAction,
  revokePlatformAdminAction,
} from "@/lib/actions/admin";
import { getCurrentContext } from "@/lib/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmForm } from "@/components/app/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function AdminPlatformAdminsPage() {
  const [admins, ctx, locale] = await Promise.all([
    listPlatformAdmins(),
    getCurrentContext(),
    getLocale(),
  ]);
  const t = await getTranslations("admin.platformAdmins");
  const tCols = await getTranslations("admin.platformAdmins.columns");
  const tPromote = await getTranslations("admin.platformAdmins.promote");

  return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {/* Existing admins */}
      <Card className="p-0 overflow-hidden mb-6">
        {/* Mobile / tablet portrait : cards */}
        <ul className="lg:hidden divide-y divide-border">
          {admins.map((a) => {
            const displayName =
              [a.firstName, a.lastName].filter(Boolean).join(" ") || "—";
            const isSelf = a.userId === ctx.user.id;
            return (
              <li key={a.userId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <span className="font-medium text-sm">{displayName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(a.createdAt).toLocaleDateString(locale)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span>{a.email ?? "—"}</span>
                  {!a.isConfirmed && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                      {t("pendingBadge")}
                    </span>
                  )}
                </div>
                {(a.note || a.grantedByEmail) && (
                  <div className="text-xs text-muted-foreground mb-2">
                    {a.note && <span>{a.note}</span>}
                    {a.note && a.grantedByEmail && <span> · </span>}
                    {a.grantedByEmail && <span>{tCols("grantedBy")}: {a.grantedByEmail}</span>}
                  </div>
                )}
                <div className="flex items-center gap-1 mt-2">
                  {!a.isConfirmed && a.email && (
                    <form action={resendInvitationAction}>
                      <input type="hidden" name="email" value={a.email} />
                      <SubmitButton size="sm" variant="ghost">{t("resend")}</SubmitButton>
                    </form>
                  )}
                  {isSelf ? (
                    <span className="text-xs text-muted-foreground" title={t("revokeSelfBlocked")}>—</span>
                  ) : (
                    <ConfirmForm action={revokePlatformAdminAction} message={t("revokeConfirm")}>
                      <input type="hidden" name="userId" value={a.userId} />
                      <SubmitButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">
                        {t("revoke")}
                      </SubmitButton>
                    </ConfirmForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Desktop : table */}
        <div className="hidden lg:block overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-secondary/40 text-muted-foreground text-xs">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">{tCols("name")}</th>
              <th className="px-4 py-2 font-medium">{tCols("email")}</th>
              <th className="px-4 py-2 font-medium">{tCols("note")}</th>
              <th className="px-4 py-2 font-medium">{tCols("grantedBy")}</th>
              <th className="px-4 py-2 font-medium">{tCols("grantedAt")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {admins.map((a) => {
              const displayName =
                [a.firstName, a.lastName].filter(Boolean).join(" ") || "—";
              const isSelf = a.userId === ctx.user.id;
              return (
                <tr key={a.userId} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">{displayName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>{a.email ?? "—"}</span>
                      {!a.isConfirmed && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                          {t("pendingBadge")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {a.note ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {a.grantedByEmail ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(a.createdAt).toLocaleDateString(locale)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {!a.isConfirmed && a.email && (
                        <form action={resendInvitationAction}>
                          <input type="hidden" name="email" value={a.email} />
                          <SubmitButton size="sm" variant="ghost">
                            {t("resend")}
                          </SubmitButton>
                        </form>
                      )}
                      {isSelf ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title={t("revokeSelfBlocked")}
                        >
                          —
                        </span>
                      ) : (
                        <ConfirmForm
                          action={revokePlatformAdminAction}
                          message={t("revokeConfirm")}
                        >
                          <input type="hidden" name="userId" value={a.userId} />
                          <SubmitButton
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                          >
                            {t("revoke")}
                          </SubmitButton>
                        </ConfirmForm>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Card>

      {/* Promote */}
      <Card className="p-6">
        <h2 className="font-serif text-base font-bold">{tPromote("title")}</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {tPromote("subtitle")}
        </p>
        <form action={promotePlatformAdminAction} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{tPromote("email")}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">{tPromote("note")}</Label>
              <Input id="note" name="note" maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{tPromote("firstName")}</Label>
              <Input id="firstName" name="firstName" maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{tPromote("lastName")}</Label>
              <Input id="lastName" name="lastName" maxLength={100} />
            </div>
          </div>
          <div className="flex items-center justify-end">
            <SubmitButton>{tPromote("submit")}</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

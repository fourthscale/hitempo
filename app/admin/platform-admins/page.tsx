import { getTranslations, getLocale } from "next-intl/server";
import {
  listPlatformAdmins,
  promotePlatformAdminAction,
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
        <table className="w-full text-sm">
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
                  <td className="px-4 py-3 text-muted-foreground">{a.email ?? "—"}</td>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

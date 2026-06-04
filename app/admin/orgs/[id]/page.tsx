import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { Pencil, Trash2 } from "lucide-react";
import {
  getOrgWithMembers,
  removeMemberFromOrgAction,
  resendInvitationAction,
  softDeleteOrgAction,
} from "@/lib/actions/admin";
import { selectOrgAction } from "@/lib/auth/actions";
import { PageHeader } from "@/components/app/page-header";
import { ConfirmForm } from "@/components/app/confirm-form";
import { InviteMemberForm } from "@/components/app/invite-member-form";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card } from "@/components/ui/card";
import { getCurrentContext } from "@/lib/auth/context";
import { formatDateInTz } from "@/lib/i18n/format-date";

const ROLE_OPTIONS = ["owner", "admin", "commercial", "viewer"] as const;
type Role = (typeof ROLE_OPTIONS)[number];

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getOrgWithMembers(id);
  if (!result) notFound();
  const { org, members } = result;

  const locale = await getLocale();
  const { membership, organization } = await getCurrentContext();
  const userTimezone = membership?.timezone ?? organization?.timezone ?? "UTC";
  const t = await getTranslations("admin.orgs");
  const tDetail = await getTranslations("admin.orgs.detail");
  const tInvite = await getTranslations("admin.orgs.detail.memberInvite");
  const tRoles = await getTranslations("admin.orgs.detail.roles");
  const tCols = await getTranslations("admin.orgs.detail.memberColumns");
  const tDelete = await getTranslations("admin.orgs.delete");

  const enterOrg = selectOrgAction.bind(null, org.id);

  return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader
        title={org.name}
        subtitle={`${tDetail("subtitle")} · ${org.slug}`}
        right={
          <div className="flex items-center gap-2">
            <form action={enterOrg}>
              <SubmitButton size="sm" variant="outline">
                {t("select")}
              </SubmitButton>
            </form>
            <Link href={`/admin/orgs/${org.id}/edit`}>
              <Button type="button" size="sm" variant="outline">
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                {t("edit_action")}
              </Button>
            </Link>
            {!org.deletedAt && (
              <ConfirmForm action={softDeleteOrgAction} message={tDelete("confirm")}>
                <input type="hidden" name="id" value={org.id} />
                <SubmitButton
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  {tDelete("trigger")}
                </SubmitButton>
              </ConfirmForm>
            )}
          </div>
        }
      />

      {org.deletedAt && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          {t("deletedBadge")} · {formatDateInTz(org.deletedAt, locale, { timeZone: userTimezone, dateStyle: "medium", timeStyle: "short" })}
        </div>
      )}

      {/* Org info */}
      <Card className="p-6 mb-6">
        <h2 className="font-serif text-base font-bold mb-4">{tDetail("infoTitle")}</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <InfoRow label={tDetail("infoLabels.plan")} value={org.plan} />
          <InfoRow label={tDetail("infoLabels.defaultLocale")} value={org.defaultLocale} />
          <InfoRow
            label={tDetail("infoLabels.supportedLocales")}
            value={(org.supportedLocales ?? []).join(", ")}
          />
          <InfoRow
            label={tDetail("infoLabels.created")}
            value={formatDateInTz(org.createdAt, locale, { timeZone: userTimezone, dateStyle: "medium", timeStyle: "short" })}
          />
        </dl>
      </Card>

      {/* Members */}
      <Card className="p-0 overflow-hidden mb-6">
        <div className="p-5 border-b border-border">
          <h2 className="font-serif text-base font-bold">{tDetail("membersTitle")}</h2>
        </div>
        {members.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            {tDetail("membersEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-secondary/40 text-muted-foreground text-xs">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">{tCols("name")}</th>
                <th className="px-4 py-2 font-medium">{tCols("email")}</th>
                <th className="px-4 py-2 font-medium">{tCols("role")}</th>
                <th className="px-4 py-2 font-medium">{tCols("joined")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => {
                const displayName =
                  [m.firstName, m.lastName].filter(Boolean).join(" ") || "—";
                return (
                  <tr key={m.userId} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">{displayName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>{m.email ?? "—"}</span>
                        {!m.isConfirmed && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                            {tDetail("pendingBadge")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="capitalize text-xs px-1.5 py-0.5 rounded bg-secondary">
                        {tRoles(m.role as Role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateInTz(m.joinedAt, locale, { timeZone: userTimezone, dateStyle: "medium" })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {!m.isConfirmed && m.email && (
                          <form action={resendInvitationAction}>
                            <input type="hidden" name="email" value={m.email} />
                            <input type="hidden" name="orgId" value={org.id} />
                            <SubmitButton size="sm" variant="ghost">
                              {tDetail("resend")}
                            </SubmitButton>
                          </form>
                        )}
                        <ConfirmForm
                          action={removeMemberFromOrgAction}
                          message={tDetail("removeConfirm")}
                        >
                          <input type="hidden" name="orgId" value={org.id} />
                          <input type="hidden" name="userId" value={m.userId} />
                          <SubmitButton
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                          >
                            {tDetail("remove")}
                          </SubmitButton>
                        </ConfirmForm>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>

      {/* Invite */}
      <Card className="p-6">
        <h2 className="font-serif text-base font-bold">{tInvite("title")}</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {tInvite("subtitle")}
        </p>
        <InviteMemberForm orgId={org.id} />
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-foreground mt-0.5">{value ?? "—"}</dd>
    </div>
  );
}

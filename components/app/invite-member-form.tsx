"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { checkEmailForInviteAction, inviteUserToOrgAction } from "@/lib/actions/admin";
import { cn } from "@/lib/utils";

type EmailStatus = "idle" | "checking" | "new" | "existing_confirmed" | "existing_pending";

const ROLE_OPTIONS = ["owner", "admin", "commercial", "viewer"] as const;
const LOCALE_OPTIONS = ["fr", "en"] as const;

export function InviteMemberForm({
  orgId,
}: {
  orgId: string;
}) {
  const t = useTranslations("admin.orgs.detail.memberInvite");
  const tRoles = useTranslations("admin.orgs.detail.roles");

  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [existingName, setExistingName] = useState("");
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const email = e.target.value.trim();

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!email || !email.includes("@") || !email.includes(".")) {
      setEmailStatus("idle");
      setExistingName("");
      return;
    }

    setEmailStatus("checking");
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await checkEmailForInviteAction(email);
        setEmailStatus(result.status);
        setExistingName(result.displayName);
      });
    }, 700);
  }

  const isResolved =
    emailStatus === "new" ||
    emailStatus === "existing_confirmed" ||
    emailStatus === "existing_pending";
  // Name fields are disabled for confirmed existing users (name is global, not per-org)
  const nameFieldsDisabled = !isResolved || emailStatus === "existing_confirmed";
  const nameFieldsRequired = emailStatus === "new";

  return (
    <form action={inviteUserToOrgAction} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Email — always visible */}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="inv-email">{t("email")}</Label>
          <div className="relative max-w-sm">
            <Input
              id="inv-email"
              name="email"
              type="email"
              required
              onChange={handleEmailChange}
            />
            {emailStatus === "checking" && (
              <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Role */}
        <div className="space-y-1.5">
          <Label htmlFor="inv-role">{t("role")}</Label>
          <select
            id="inv-role"
            name="role"
            defaultValue="commercial"
            disabled={!isResolved}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{tRoles(r)}</option>
            ))}
          </select>
        </div>

        {/* Preferred locale */}
        <div className="space-y-1.5">
          <Label htmlFor="inv-locale">{t("preferredLocale")}</Label>
          <select
            id="inv-locale"
            name="preferredLocale"
            defaultValue="fr"
            disabled={!isResolved}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {LOCALE_OPTIONS.map((l) => (
              <option key={l} value={l}>{t(`localeOptions.${l}`)}</option>
            ))}
          </select>
        </div>

        {/* firstName / lastName — disabled for unresolved or confirmed existing users */}
        <div className="space-y-1.5">
          <Label htmlFor="inv-firstName">
            {t("firstName")}
            {nameFieldsRequired && (
              <span className="text-muted-foreground ml-1 text-xs">{t("required")}</span>
            )}
          </Label>
          <Input
            id="inv-firstName"
            name="firstName"
            maxLength={100}
            required={nameFieldsRequired}
            disabled={nameFieldsDisabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-lastName">
            {t("lastName")}
            {nameFieldsRequired && (
              <span className="text-muted-foreground ml-1 text-xs">{t("required")}</span>
            )}
          </Label>
          <Input
            id="inv-lastName"
            name="lastName"
            maxLength={100}
            required={nameFieldsRequired}
            disabled={nameFieldsDisabled}
          />
        </div>
      </div>

      {/* Status banner */}
      {emailStatus === "existing_confirmed" && (
        <div className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
          "bg-emerald-50 text-emerald-800 border border-emerald-200",
        )}>
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("existingConfirmed", { name: existingName })}</span>
        </div>
      )}

      {emailStatus === "existing_pending" && (
        <div className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
          "bg-amber-50 text-amber-800 border border-amber-200",
        )}>
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("existingPending", { name: existingName })}</span>
        </div>
      )}

      {emailStatus === "new" && (
        <div className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
          "bg-blue-50 text-blue-800 border border-blue-200",
        )}>
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("newUser")}</span>
        </div>
      )}

      <div className="flex items-center justify-end">
        <SubmitButton disabled={!isResolved}>{t("submit")}</SubmitButton>
      </div>
    </form>
  );
}

"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Global feedback surface for Server Action failures.
 *
 * Mounted once per top-level layout, this client component watches the URL
 * for an `action_error=<code>` query param set by `wrapActionError`
 * (`lib/actions/wrap-action-error.ts`). When the param appears it opens a
 * modal with the localized message and, on dismiss, strips the param so a
 * page refresh doesn't re-open the modal.
 *
 * Codes that need contextual data (e.g. `already_member` shows which email)
 * receive that data via sibling query params (here : `email`). The list of
 * recognized codes mirrors the `UserFacingActionError` subclasses ; unknown
 * codes fall back to a generic message.
 */
const KNOWN_CODES = [
  "invalid_input",
  "invalid_slug",
  "already_member",
  "cannot_revoke_self",
  "forbidden",
  "forbidden_not_platform_admin",
  "message_not_found",
  "interaction_insert_failed",
  "not_found",
] as const;
type KnownCode = (typeof KNOWN_CODES)[number];

function isKnown(code: string | null): code is KnownCode {
  return !!code && (KNOWN_CODES as readonly string[]).includes(code);
}

export function ActionErrorModal() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const t = useTranslations("actionErrors");

  const code = search.get("action_error");
  const email = search.get("email") ?? undefined;
  const entity = search.get("entity") ?? undefined;

  // `open` is derived directly from the URL — no `useState` to keep in sync.
  // Dismiss = strip the query params via `router.replace`, which triggers a
  // re-render with `code === null` and unmounts the dialog.
  const open = isKnown(code);

  const handleClose = useCallback(() => {
    const next = new URLSearchParams(search.toString());
    next.delete("action_error");
    next.delete("email");
    next.delete("entity");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }, [search, pathname, router]);

  if (!open) return null;

  // Pick the localized message. `already_member` takes an email param ;
  // `not_found` takes an entity-kind param ; everything else uses a fixed key.
  const message = (() => {
    if (code === "already_member") {
      return email ? t("already_member", { email }) : t("already_member_generic");
    }
    if (code === "not_found") {
      return entity ? t(`not_found_${entity}` as never) : t("not_found_generic");
    }
    return t(code);
  })();

  return (
    <Dialog open onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-900">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="text-sm text-foreground pt-2">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={handleClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

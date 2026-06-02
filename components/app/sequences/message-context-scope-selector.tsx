"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateSequenceMessageContextScopeAction } from "@/lib/actions/sequences";
import {
  SEQUENCE_MESSAGE_CONTEXT_SCOPES,
  type SequenceMessageContextScope,
} from "@/lib/sequences/message-context-scope";
import { cn } from "@/lib/utils";

/**
 * Sprint 12 — sequence-level "AI message context scope" picker.
 *
 * Sits in the sequence detail "Advanced settings" card next to the
 * unknown-outcome strategy picker. Same UX pattern : two opinionated
 * options as pressable cards, recommended one highlighted.
 *
 * The dialog at message generation time can still override this per
 * message — this is just the default the engine uses when nothing else
 * is set on the step / dialog.
 */
export function MessageContextScopeSelector({
  sequenceId,
  current,
}: {
  sequenceId: string;
  current: SequenceMessageContextScope;
}) {
  const t = useTranslations("pages.sequences.messageContextScope");
  const [pending, startTransition] = useTransition();

  function select(next: SequenceMessageContextScope) {
    if (next === current || pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("sequenceId", sequenceId);
      fd.append("scope", next);
      try {
        await updateSequenceMessageContextScopeAction(fd);
      } catch {
        // Surfaced via the global ActionErrorModal.
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{t("title")}</div>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {SEQUENCE_MESSAGE_CONTEXT_SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => select(s)}
            disabled={pending}
            className={cn(
              "text-left rounded-md border px-3 py-2 text-sm transition-colors",
              "hover:border-foreground/40",
              current === s
                ? "border-brand-teal bg-brand-teal/5 ring-1 ring-brand-teal/30"
                : "border-border",
              pending && "opacity-60 cursor-wait",
            )}
            aria-pressed={current === s}
          >
            <div className="font-medium">{t(`options.${s}.label`)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {t(`options.${s}.detail`)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

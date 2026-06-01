"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateSequenceUnknownOutcomeStrategyAction } from "@/lib/actions/sequences";
import {
  SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES,
  isSequenceUnknownOutcomeStrategy,
  type SequenceUnknownOutcomeStrategy,
} from "@/lib/sequences/unknown-outcome-strategy";
import { cn } from "@/lib/utils";

export function UnknownOutcomeStrategySelector({
  sequenceId,
  current,
}: {
  sequenceId: string;
  current: SequenceUnknownOutcomeStrategy;
}) {
  const t = useTranslations("pages.sequences.unknownOutcomeStrategy");
  const [pending, startTransition] = useTransition();

  function select(next: SequenceUnknownOutcomeStrategy) {
    if (next === current || pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("sequenceId", sequenceId);
      fd.append("strategy", next);
      try {
        await updateSequenceUnknownOutcomeStrategyAction(fd);
      } catch {
        // Surfaced through the global ActionErrorModal.
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{t("title")}</div>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES.map((s) => (
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

/** Helper for server components that have a raw string from the DB. */
export function coerceStrategy(raw: string | null | undefined): SequenceUnknownOutcomeStrategy {
  return isSequenceUnknownOutcomeStrategy(raw) ? raw : "park";
}

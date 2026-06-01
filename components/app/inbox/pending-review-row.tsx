"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ExternalLink } from "lucide-react";
import { confirmAiClassificationAction } from "@/lib/actions/interactions";
import {
  InteractionOutcomeMenu,
  type InteractionOutcome,
} from "@/components/app/interaction-outcome-menu";

export type PendingReviewRowProps = {
  interaction: {
    id: string;
    occurredAt: Date;
    summary: string | null;
    aiIntentLabel: string;
    aiIntentConfidence: string | null;
    aiIntentReasoning: string | null;
    contact: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    } | null;
    company: { id: string; name: string };
  };
  /** True when this label maps to a concrete outcome the user can confirm. */
  hasSuggestedOutcome: boolean;
};

export function PendingReviewRow({ interaction, hasSuggestedOutcome }: PendingReviewRowProps) {
  const t = useTranslations("pages.inboxPendingReview");
  const tIntent = useTranslations("intentLabel");
  const tOutcome = useTranslations("interactionOutcome");
  const [pending, startTransition] = useTransition();

  const contactDisplay =
    interaction.contact
      ? [interaction.contact.firstName, interaction.contact.lastName]
          .filter(Boolean)
          .join(" ") || interaction.contact.email || t("unknownContact")
      : t("unknownContact");

  const confidencePct =
    interaction.aiIntentConfidence != null
      ? Math.round(Number(interaction.aiIntentConfidence) * 100)
      : null;

  function confirm() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("interactionId", interaction.id);
      fd.append("label", interaction.aiIntentLabel);
      try {
        await confirmAiClassificationAction(fd);
      } catch {
        // Surfaced through the global ActionErrorModal.
      }
    });
  }

  return (
    <article className="rounded-md border bg-card p-4 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">
            {contactDisplay}
          </div>
          <Link
            href={`/companies/${interaction.company.id}`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {interaction.company.name}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <time className="text-xs text-muted-foreground">
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(interaction.occurredAt)}
        </time>
      </header>

      {interaction.summary && (
        <blockquote className="rounded border-l-2 border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm text-foreground whitespace-pre-line">
          {interaction.summary}
        </blockquote>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-violet-50 text-violet-700 px-2 py-0.5 font-medium">
          {t("aiSuggestion")} : {tIntent(interaction.aiIntentLabel)}
        </span>
        {confidencePct != null && (
          <span className="text-muted-foreground">
            {t("confidence")} {confidencePct}%
          </span>
        )}
      </div>

      {interaction.aiIntentReasoning && (
        <p className="text-xs text-muted-foreground italic">
          {interaction.aiIntentReasoning}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {hasSuggestedOutcome && (
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" />
            {t("confirm")}
          </button>
        )}
        <span className="text-xs text-muted-foreground">{t("orOverride")}</span>
        <InteractionOutcomeMenu
          interactionId={interaction.id}
          current={null}
          labels={{
            outcomes: {
              no_response: tOutcome("no_response"),
              positive_reply: tOutcome("positive_reply"),
              negative_reply: tOutcome("negative_reply"),
              out_of_office: tOutcome("out_of_office"),
              wrong_contact: tOutcome("wrong_contact"),
              rdv_scheduled: tOutcome("rdv_scheduled"),
              opted_out: tOutcome("opted_out"),
            } as Record<InteractionOutcome, string>,
            setOutcome: t("setOutcome"),
            clearOutcome: t("clearOutcome"),
          }}
        />
      </div>
    </article>
  );
}

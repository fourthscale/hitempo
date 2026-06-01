import { getTranslations } from "next-intl/server";
import { Inbox } from "lucide-react";
import { getActiveOrg } from "@/lib/auth/context";
import { getPendingReviewInteractions } from "@/db/queries/interactions";
import { intentToOutcome, isIntentLabel } from "@/lib/ai/classification/intent-labels";
import { PendingReviewRow } from "@/components/app/inbox/pending-review-row";

/**
 * Sprint 11.5 / Slice C — "Pending review" inbox.
 *
 * Surfaces inbound replies the LLM classifier examined but couldn't
 * auto-qualify (confidence < AUTO_APPLY_THRESHOLD). The sale either
 * confirms the AI's guess in one click (sets outcome = mapped label) or
 * overrides via the existing outcome dropdown. Confirmed rows fall out of
 * the listing on the next revalidate.
 *
 * Server component : no client JS for the page shell ; only the row's
 * "Confirmer" button and outcome menu are interactive.
 */
export default async function PendingReviewPage() {
  const { activeOrganization } = await getActiveOrg();
  const t = await getTranslations("pages.inboxPendingReview");

  const rows = await getPendingReviewInteractions(activeOrganization.id);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">{t("emptyTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            {t("emptyDescription")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const label = row.aiIntentLabel ?? "";
            const hasOutcome = isIntentLabel(label) && intentToOutcome(label) !== null;
            return (
              <PendingReviewRow
                key={row.id}
                interaction={{
                  id: row.id,
                  occurredAt: row.occurredAt,
                  summary: row.summary,
                  aiIntentLabel: label,
                  aiIntentConfidence: row.aiIntentConfidence,
                  aiIntentReasoning: row.aiIntentReasoning,
                  contact: row.contact
                    ? {
                        id: row.contact.id ?? "",
                        firstName: row.contact.firstName,
                        lastName: row.contact.lastName,
                        email: row.contact.email,
                      }
                    : null,
                  company: { id: row.company.id, name: row.company.name },
                }}
                hasSuggestedOutcome={hasOutcome}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

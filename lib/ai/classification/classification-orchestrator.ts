import "server-only";

import {
  applyInteractionClassification,
  getInteractionForClassification,
} from "@/db/queries/interactions";
import { inngest } from "@/lib/inngest/client";
import { EVENT_OUTCOME_QUALIFIED } from "@/lib/sequences/engine/events";
import { ClassificationParseError } from "./errors";
import type { InteractionIntentClassifier } from "./interaction-intent-classifier";
import type { IntentClassificationLocale } from "./prompt-builder";

/**
 * Coordinates the end-to-end "classify one interaction" use case :
 *
 *   1. Load the interaction row (idempotency : skip if `aiProcessedAt` set).
 *   2. Build the input from the snippet + contact's preferred locale.
 *   3. Ask the classifier (which logs LLM cost into `llm_usage`).
 *   4. Persist label/confidence/reasoning + optionally bump outcome.
 *   5. Mark the row as processed (timestamp).
 *
 * Failures :
 *   - Missing row / already processed → no-op return.
 *   - Empty / nil snippet → mark processed with label="unknown", confidence=0
 *     so we don't burn an LLM call on rows we know are unclassifiable.
 *   - ClassificationParseError → same defensive recording so retries don't
 *     loop forever ; the LLM cost was already logged by the classifier.
 *   - Any other throw bubbles up so Inngest retries with backoff.
 *
 * Designed so the Inngest function is a 5-line wrapper : load factory →
 * call classify(orgId, interactionId).
 */
export class ClassificationOrchestrator {
  constructor(private readonly classifier: InteractionIntentClassifier) {}

  public async classify(orgId: string, interactionId: string): Promise<{
    status: "skipped" | "applied" | "stored" | "unknown";
  }> {
    const row = await getInteractionForClassification(orgId, interactionId);
    if (!row) return { status: "skipped" };
    if (row.aiProcessedAt) return { status: "skipped" };

    const snippet = (row.summary ?? "").trim();
    if (!snippet) {
      await applyInteractionClassification(orgId, interactionId, {
        label: "unknown",
        confidence: 0,
        reasoning: "empty snippet",
      });
      return { status: "unknown" };
    }

    const locale = resolveLocale(row.contact?.preferredLanguage ?? null);

    try {
      const result = await this.classifier.classify({
        input: { snippet, locale, outboundSubject: row.subject ?? null },
        organizationId: orgId,
        userId: row.userId,
        interactionId,
      });

      await applyInteractionClassification(orgId, interactionId, {
        label: result.output.label,
        confidence: result.output.confidence,
        reasoning: result.output.reasoning,
        // Only set outcome when the tier said it's safe to auto-apply.
        // Slice C will introduce per-sequence "park vs continue" config
        // for rows where outcome stays null.
        outcome: result.outcome ?? undefined,
      });

      // Slice D — emit the outcome-qualified wake-up event whenever we
      // actually bumped the interaction.outcome (tier === "auto"). The
      // sequence engine's wake handler will fan out advance events to
      // any enrolment parked on this contact awaiting qualification.
      if (result.tier === "auto" && row.contactId) {
        try {
          await inngest.send({
            name: EVENT_OUTCOME_QUALIFIED,
            data: { organizationId: orgId, contactId: row.contactId },
          });
        } catch (err) {
          // Don't bubble — the persistence already succeeded. The next
          // scheduled tick will catch parked enrolments anyway.
          console.error("[classification-orchestrator] outcome.qualified emit failed", err);
        }
      }

      return { status: result.tier === "auto" ? "applied" : "stored" };
    } catch (err) {
      if (err instanceof ClassificationParseError) {
        await applyInteractionClassification(orgId, interactionId, {
          label: "unknown",
          confidence: 0,
          reasoning: `parse_error: ${err.reason}`,
        });
        return { status: "unknown" };
      }
      throw err;
    }
  }
}

function resolveLocale(raw: string | null): IntentClassificationLocale {
  return raw === "fr" ? "fr" : "en";
}

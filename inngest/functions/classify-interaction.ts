import { inngest } from "@/lib/inngest/client";
import { ClassificationOrchestratorFactory } from "@/lib/ai/classification/classification-orchestrator-factory";
import { EVENT_CLASSIFY_INTERACTION } from "@/lib/ai/classification/events";

/**
 * Inngest function : run the LLM intent classifier on a single inbound
 * interaction.
 *
 * Triggered by `interactions/classify` events emitted by :
 *   - the Gmail reply poller right after recording an inbound reply,
 *   - any future "re-classify" UI action (manual retry from the dashboard),
 *   - one-off backfill scripts.
 *
 * Concurrency : capped to 1 per interactionId so a duplicate event (poller
 * crash + retry) can't double-charge the LLM ; the orchestrator's
 * `aiProcessedAt` check is the persistent idempotency guard.
 *
 * Retries on transient LLM failures are handled by Inngest's default backoff.
 * Parse / "unknown" outcomes are persisted by the orchestrator itself so
 * they're NOT retried (would just burn tokens).
 */

async function handleClassify({
  event,
}: {
  event: { data: { organizationId: string; interactionId: string } };
}) {
  const { organizationId, interactionId } = event.data;
  return ClassificationOrchestratorFactory.getInstance().classify(
    organizationId,
    interactionId,
  );
}

const classifyInteraction = inngest.createFunction(
  {
    id: "interactions/classify",
    name: "Interactions — classify one reply",
    concurrency: { key: "event.data.interactionId", limit: 1 },
    triggers: [{ event: EVENT_CLASSIFY_INTERACTION }],
  },
  handleClassify,
);

export const classifyInteractionFunctions = [classifyInteraction];

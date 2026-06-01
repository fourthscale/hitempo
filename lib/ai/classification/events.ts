/**
 * Event names emitted into the Inngest bus by the classification subsystem.
 *
 * Kept in a tiny module so any producer (gmail-reply-poller, future manual
 * "re-classify" UI action, batch backfill) can `import { EVENT_CLASSIFY }`
 * without dragging in the Inngest function definitions.
 */

export const EVENT_CLASSIFY_INTERACTION = "interactions/classify" as const;

export type ClassifyInteractionEvent = {
  name: typeof EVENT_CLASSIFY_INTERACTION;
  data: {
    organizationId: string;
    interactionId: string;
  };
};

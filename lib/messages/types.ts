/**
 * Shared message types — used by prompt builders, server actions, UI.
 *
 * Decoupled from `db/schema.ts` pg enums so the prompt builder stays pure
 * (no DB import). The string union types here mirror the DB enum values
 * exactly ; consistency is enforced by a single source of truth at compile
 * time via the action's Zod schema.
 */

export type MessageChannel = "email" | "linkedin";

export type MessageIntent =
  | "first_contact"
  | "follow_up"
  | "meeting_request"
  | "proposal_send"
  | "reconnect"
  | "other";

export type MessageLocale = "fr" | "en";

/**
 * Combined channel × intent — what the UI dropdown emits. Server action
 * splits it back into channel + intent before calling the prompt builder.
 */
export type ChannelIntent =
  | "email-first_contact"
  | "email-follow_up"
  | "email-meeting_request"
  | "email-proposal_send"
  | "email-reconnect"
  | "linkedin-first_contact"
  | "linkedin-follow_up"
  | "linkedin-meeting_request"
  | "linkedin-reconnect";

export function parseChannelIntent(value: ChannelIntent): {
  channel: MessageChannel;
  intent: MessageIntent;
} {
  // Format guarantees exactly one "-" separating channel from intent ;
  // intent values use "_" internally (e.g. "first_contact").
  const dashIndex = value.indexOf("-");
  return {
    channel: value.slice(0, dashIndex) as MessageChannel,
    intent: value.slice(dashIndex + 1) as MessageIntent,
  };
}

/**
 * Maps the message intent (what we generated) to the interaction type (what
 * we log once the user actually sends it). Used by `logSentInteractionAction`
 * when the user clicks "Log interaction" inside the generation dialog.
 *
 * Interaction types are the ones exposed by the `interactions.type` pg enum :
 *   first_contact, follow_up, call, visit, linkedin, meeting, demo,
 *   proposal_sent, note.
 */
export type InteractionType =
  | "first_contact"
  | "follow_up"
  | "call"
  | "visit"
  | "linkedin"
  | "meeting"
  | "demo"
  | "proposal_sent"
  | "note";

export function messageIntentToInteractionType(intent: MessageIntent): InteractionType {
  switch (intent) {
    case "first_contact":   return "first_contact";
    case "follow_up":       return "follow_up";
    case "meeting_request": return "meeting";
    case "proposal_send":   return "proposal_sent";
    case "reconnect":       return "follow_up";
    case "other":           return "note";
  }
}

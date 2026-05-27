import type { ChannelIntent, MessageLocale } from "./types";

/**
 * Pure helper : given a task, returns the dialog defaults for generation.
 *
 * The task's `type` is a mix of channel and intent (email/linkedin = channel,
 * follow_up = intent). We map both to a canonical (channel, intent) tuple.
 *
 * Returns null when the task isn't a message-generation candidate
 * (phone, visit, research…) — callers use that as a feature gate.
 */
export function getMessageDefaultsFromTask(task: {
  type: string;
  contactId?: string | null;
}): { channelIntent: ChannelIntent } | null {
  // No contact → can't generate (we need someone to write to).
  if (!task.contactId) return null;

  switch (task.type) {
    case "email":
      // Without explicit intent on the task, default to first_contact.
      // The user can still change it in the dialog dropdown.
      return { channelIntent: "email-first_contact" };
    case "linkedin":
      return { channelIntent: "linkedin-first_contact" };
    case "follow_up":
      return { channelIntent: "email-follow_up" };
    default:
      return null;
  }
}

/**
 * Default locale picker : prefer the contact's preferredLanguage when it's a
 * supported message locale ; fall back to FR.
 */
export function getMessageDefaultLocale(preferredLanguage: string | null | undefined): MessageLocale {
  return preferredLanguage === "en" ? "en" : "fr";
}

/**
 * Computes the dialog's `detectedSignal` prop from raw company fields.
 * `isFresh` = signal detected within the last 30 days, same threshold as the
 * scoring bonus (sprint 06).
 */
export function getDetectedSignalProp(
  signalType: string | null,
  signalDetectedAt: Date | null,
): { type: string; daysAgo: number; isFresh: boolean } | null {
  if (!signalType) return null;
  if (!signalDetectedAt) {
    return { type: signalType, daysAgo: 0, isFresh: false };
  }
  const daysAgo = Math.floor(
    (Date.now() - new Date(signalDetectedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  return {
    type: signalType,
    daysAgo,
    isFresh: daysAgo <= 30,
  };
}

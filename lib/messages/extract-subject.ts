import type { MessageChannel, MessageLocale } from "./types";

/**
 * Pure function : separates the subject line from the body of an email message
 * produced by the LLM. For LinkedIn messages there's no subject — the entire
 * content is the body.
 *
 * Email format expected from the model (enforced by the system prompt) :
 *
 *     Objet: <subject>
 *     <blank line>
 *     <body...>
 *
 * (or "Subject: ..." in English).
 *
 * We're tolerant if the model produced slightly different shapes — fallback
 * rules below — but the contract with the prompt is "first line = Objet: X".
 */
export function extractSubjectAndBody(
  content: string,
  channel: MessageChannel,
  locale: MessageLocale,
): { subject: string | null; body: string } {
  if (channel === "linkedin") {
    return { subject: null, body: content.trim() };
  }

  const subjectKey = locale === "fr" ? "objet" : "subject";
  const firstLineEnd = content.indexOf("\n");

  // No newline at all → all body, no subject we can confidently extract.
  if (firstLineEnd === -1) {
    return { subject: null, body: content.trim() };
  }

  const firstLine = content.slice(0, firstLineEnd).trim();
  const rest = content.slice(firstLineEnd + 1);

  // Match case-insensitive "Objet:" / "Subject:" at start of first line.
  const re = new RegExp(`^${subjectKey}\\s*:\\s*(.+)$`, "i");
  const match = firstLine.match(re);
  if (!match) {
    // Format off — treat the whole content as body.
    return { subject: null, body: content.trim() };
  }

  const subject = match[1]!.trim();
  // Drop the conventional blank line right after the subject if present.
  const body = rest.replace(/^\s*\n/, "").trim();
  return { subject, body };
}

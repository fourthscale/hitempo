/**
 * MIME message construction for the Gmail `users.messages.send` endpoint.
 *
 * The Gmail API expects a single `raw` field containing the full RFC 2822
 * message, URL-safe-base64 encoded. We model the actual MIME layout as a
 * Strategy so the call site doesn't care whether the email is plain-text
 * (most outbound for MVP), multipart with attachments (devis / prez PDFs),
 * or — later — HTML or S/MIME-signed.
 *
 * Picking the strategy is the job of `MimeMessageBuilder.pickStrategy()` :
 * - no attachments → TextOnlyMimeStrategy
 * - 1+ attachments → MultipartMixedMimeStrategy
 *
 * Both strategies emit URL-safe base64. Body is always UTF-8 plain text
 * for now (MVP). Subject is RFC 2047-encoded when non-ASCII.
 */

export type MimeAttachment = {
  filename: string;
  mimeType: string;
  /** Raw bytes — the strategy handles base64 encoding. */
  content: Buffer;
};

export type MimeMessageInput = {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: MimeAttachment[];
  /**
   * Sprint 15 — when set, the builder injects standard threading headers
   * so the recipient's client renders the message as a real reply :
   *   - `In-Reply-To: <message-id>`
   *   - `References: <chain>` if `references` is set, else `<message-id>`
   * The angle brackets are added by the builder if missing.
   *
   * Subject prefixing with "Re: " is NOT handled here — the caller is
   * responsible for that, so the same builder remains usable for non-
   * threaded sends.
   */
  inReplyToMessageId?: string;
  /**
   * Sprint 15 — full RFC 5322 References chain (space-separated message-ids
   * with angle brackets, oldest → newest, includes the parent at the end).
   * Emitted verbatim as the `References:` header. When omitted but
   * `inReplyToMessageId` is set, the builder falls back to a single-id
   * References header (immediate parent only) — defensive for call sites
   * that haven't been updated to pass the chain.
   */
  references?: string;
};

/**
 * Sprint 15 — pure helper, exported for tests. Adds the "Re: " prefix to
 * the subject unless it already starts with one (case-insensitive,
 * tolerant of optional whitespace after the colon).
 */
export function prefixRe(subject: string): string {
  return /^re:\s*/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * Sprint 15 — normalise a Gmail RFC 5322 Message-ID for use in the
 * `In-Reply-To` / `References` headers. Gmail returns the raw id without
 * angle brackets in some API surfaces and with brackets in others ;
 * normalise to the bracketed form expected by RFC 2822.
 */
function bracketMessageId(messageId: string): string {
  const trimmed = messageId.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed}>`;
}

function buildThreadingHeaders(
  inReplyToMessageId?: string,
  references?: string,
): string[] {
  if (!inReplyToMessageId) return [];
  const id = bracketMessageId(inReplyToMessageId);
  // Prefer the full chain when the caller supplied it ; fall back to the
  // parent id alone otherwise. Trim defensively — an empty/whitespace
  // string from a misconfigured caller would produce `References: ` with
  // no value, which some MTAs reject.
  const refs =
    references && references.trim().length > 0 ? references.trim() : id;
  return [`In-Reply-To: ${id}`, `References: ${refs}`];
}

export interface MimeMessageStrategy {
  /** Returns the URL-safe-base64 encoded RFC 2822 message ready for the
   *  Gmail API `raw` field. */
  build(input: MimeMessageInput): string;
}

// ---------------------------------------------------------------------------
// Helpers — small, pure, shared by all strategies
// ---------------------------------------------------------------------------

function needsRfc2047(s: string): boolean {
  return /[^\x20-\x7E]/.test(s);
}

function encodeRfc2047(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function encodeFilenameRfc2231(filename: string): string {
  if (!needsRfc2047(filename)) return `"${filename.replace(/"/g, '\\"')}"`;
  // RFC 2231 — UTF-8 percent-encoded with the language tag empty.
  return `UTF-8''${encodeURIComponent(filename)}`;
}

function urlSafeBase64(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Wraps a long base64 string into 76-char lines per RFC 2045 §6.8. Required
 * for multipart attachment parts ; some MTAs reject lines longer than 998
 * chars and even a 10 MB PDF base64-encodes to a single ~13 MB string.
 */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function buildSubjectHeader(subject: string): string {
  const value = needsRfc2047(subject) ? encodeRfc2047(subject) : subject;
  return `Subject: ${value}`;
}

// ---------------------------------------------------------------------------
// TextOnlyMimeStrategy — single-part text/plain UTF-8 message (no attachments)
// ---------------------------------------------------------------------------

export class TextOnlyMimeStrategy implements MimeMessageStrategy {
  public build(input: MimeMessageInput): string {
    if (input.attachments && input.attachments.length > 0) {
      throw new Error(
        "TextOnlyMimeStrategy cannot encode attachments — use MultipartMixedMimeStrategy.",
      );
    }
    const headers = [
      `From: ${input.from}`,
      `To: ${input.to}`,
      buildSubjectHeader(input.subject),
      ...buildThreadingHeaders(input.inReplyToMessageId, input.references),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ].join("\r\n");

    const bodyB64 = Buffer.from(input.body, "utf8").toString("base64");
    const message = `${headers}\r\n\r\n${bodyB64}`;
    return urlSafeBase64(Buffer.from(message, "utf8"));
  }
}

// ---------------------------------------------------------------------------
// MultipartMixedMimeStrategy — text body + N file attachments
// ---------------------------------------------------------------------------

/**
 * Builds a `multipart/mixed` message with a `text/plain` body part followed
 * by one `application/<mime>` part per attachment. Each attachment is
 * base64-encoded and line-wrapped to 76 chars (RFC 2045).
 */
export class MultipartMixedMimeStrategy implements MimeMessageStrategy {
  public build(input: MimeMessageInput): string {
    const attachments = input.attachments ?? [];
    if (attachments.length === 0) {
      throw new Error(
        "MultipartMixedMimeStrategy requires at least one attachment — use TextOnlyMimeStrategy.",
      );
    }

    const boundary = `=_hitempo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const topHeaders = [
      `From: ${input.from}`,
      `To: ${input.to}`,
      buildSubjectHeader(input.subject),
      ...buildThreadingHeaders(input.inReplyToMessageId, input.references),
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ].join("\r\n");

    const bodyPart = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(input.body, "utf8").toString("base64"),
    ].join("\r\n");

    const attachmentParts = attachments.map((att) => {
      const encodedFilename = encodeFilenameRfc2231(att.filename);
      const filenameAttr = encodedFilename.startsWith('"')
        ? `filename=${encodedFilename}`
        : `filename*=${encodedFilename}`;
      const wrapped = wrapBase64(att.content.toString("base64"));
      return [
        `--${boundary}`,
        `Content-Type: ${att.mimeType}; name=${encodedFilename.startsWith('"') ? encodedFilename : `"${att.filename.replace(/"/g, '\\"')}"`}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; ${filenameAttr}`,
        "",
        wrapped,
      ].join("\r\n");
    });

    const message = [
      topHeaders,
      "",
      bodyPart,
      ...attachmentParts,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    return urlSafeBase64(Buffer.from(message, "utf8"));
  }
}

// ---------------------------------------------------------------------------
// MimeMessageBuilder — picks the right strategy and exposes a single entry
// point. Keeps `GmailService.send` agnostic of MIME layout.
// ---------------------------------------------------------------------------

export class MimeMessageBuilder {
  constructor(private readonly strategy: MimeMessageStrategy) {}

  public build(input: MimeMessageInput): string {
    return this.strategy.build(input);
  }

  /**
   * Returns the canonical builder for a given input — Text-only when no
   * attachments are present, Multipart otherwise. Callers should prefer
   * this static factory over instantiating strategies directly.
   */
  public static forInput(input: MimeMessageInput): MimeMessageBuilder {
    const strategy = input.attachments && input.attachments.length > 0
      ? new MultipartMixedMimeStrategy()
      : new TextOnlyMimeStrategy();
    return new MimeMessageBuilder(strategy);
  }
}

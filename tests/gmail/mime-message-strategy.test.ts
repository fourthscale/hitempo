import { describe, expect, it } from "vitest";

import {
  MimeMessageBuilder,
  MultipartMixedMimeStrategy,
  TextOnlyMimeStrategy,
  prefixRe,
} from "@/lib/gmail/mime-message-strategy";

/**
 * Round-trips the URL-safe-base64 output back into a string so we can assert
 * on the encoded MIME message. Mirrors what the Gmail API does internally
 * when it receives the `raw` field.
 */
function decode(rawUrlSafe: string): string {
  const b64 = rawUrlSafe.replace(/-/g, "+").replace(/_/g, "/");
  // Re-pad to a multiple of 4 to satisfy strict base64 decoders.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

describe("MimeMessageBuilder.forInput", () => {
  it("picks TextOnly strategy when no attachments are passed", () => {
    const builder = MimeMessageBuilder.forInput({
      from: "rep@acme.com",
      to: "lead@hotel.fr",
      subject: "Bonjour",
      body: "Salut !",
    });
    const out = decode(builder.build({
      from: "rep@acme.com",
      to: "lead@hotel.fr",
      subject: "Bonjour",
      body: "Salut !",
    }));
    expect(out).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(out).not.toContain("multipart/mixed");
  });

  it("picks Multipart strategy when at least one attachment is present", () => {
    const builder = MimeMessageBuilder.forInput({
      from: "rep@acme.com",
      to: "lead@hotel.fr",
      subject: "Devis",
      body: "Voici le devis.",
      attachments: [
        {
          filename: "devis.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("%PDF-1.4 fake bytes"),
        },
      ],
    });
    const out = decode(builder.build({
      from: "rep@acme.com",
      to: "lead@hotel.fr",
      subject: "Devis",
      body: "Voici le devis.",
      attachments: [
        {
          filename: "devis.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("%PDF-1.4 fake bytes"),
        },
      ],
    }));
    expect(out).toContain("multipart/mixed; boundary=");
    expect(out).toContain("Content-Type: application/pdf");
    expect(out).toContain("devis.pdf");
    expect(out).toContain("Content-Disposition: attachment");
  });
});

describe("TextOnlyMimeStrategy", () => {
  it("RFC-2047-encodes non-ASCII subjects", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Prise de contact — hôtel",
        body: "Bonjour",
      }),
    );
    expect(out).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });

  it("throws if asked to encode attachments", () => {
    const s = new TextOnlyMimeStrategy();
    expect(() =>
      s.build({
        from: "a@b.com",
        to: "c@d.com",
        subject: "x",
        body: "y",
        attachments: [
          { filename: "f.pdf", mimeType: "application/pdf", content: Buffer.from("z") },
        ],
      }),
    ).toThrow(/use MultipartMixedMimeStrategy/);
  });
});

describe("MultipartMixedMimeStrategy", () => {
  it("emits one boundary-delimited part per attachment plus the body part", () => {
    const s = new MultipartMixedMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Deux PDFs",
        body: "voir PJ",
        attachments: [
          { filename: "a.pdf", mimeType: "application/pdf", content: Buffer.from("AAA") },
          { filename: "b.pdf", mimeType: "application/pdf", content: Buffer.from("BBB") },
        ],
      }),
    );
    // boundary appears at least 4 times: opening before body + opening before
    // each attachment + closing line at the end.
    const boundaryMatch = out.match(/boundary="([^"]+)"/);
    expect(boundaryMatch).not.toBeNull();
    const boundary = boundaryMatch![1];
    const occurrences = out.split(`--${boundary}`).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
    expect(out).toContain("a.pdf");
    expect(out).toContain("b.pdf");
  });

  it("throws when called with no attachments", () => {
    const s = new MultipartMixedMimeStrategy();
    expect(() =>
      s.build({
        from: "a@b.com",
        to: "c@d.com",
        subject: "x",
        body: "y",
      }),
    ).toThrow(/use TextOnlyMimeStrategy/);
  });
});

// ---------------------------------------------------------------------------
// Sprint 15 — threading helpers
// ---------------------------------------------------------------------------

describe("prefixRe", () => {
  it("adds Re: when the subject doesn't already carry one", () => {
    expect(prefixRe("Bonjour")).toBe("Re: Bonjour");
  });

  it("leaves an existing Re: prefix as-is (case-insensitive)", () => {
    expect(prefixRe("Re: Bonjour")).toBe("Re: Bonjour");
    expect(prefixRe("RE: Bonjour")).toBe("RE: Bonjour");
    expect(prefixRe("re:Bonjour")).toBe("re:Bonjour");
  });
});

describe("MimeMessageBuilder threading headers", () => {
  it("injects In-Reply-To + References + bracketed message id on TextOnly", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Re: Bonjour",
        body: "Petit suivi.",
        inReplyToMessageId: "abc123@mail.gmail.com",
      }),
    );
    expect(out).toContain("In-Reply-To: <abc123@mail.gmail.com>");
    expect(out).toContain("References: <abc123@mail.gmail.com>");
  });

  it("preserves angle brackets when already present", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Re: Bonjour",
        body: "Suivi.",
        inReplyToMessageId: "<xyz@mail.gmail.com>",
      }),
    );
    expect(out).toContain("In-Reply-To: <xyz@mail.gmail.com>");
    // Make sure we don't double-bracket.
    expect(out).not.toContain("<<xyz@mail.gmail.com>>");
  });

  it("omits threading headers when inReplyToMessageId is absent", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Bonjour",
        body: "Premier contact.",
      }),
    );
    expect(out).not.toContain("In-Reply-To:");
    expect(out).not.toContain("References:");
  });

  it("also injects threading headers on the multipart strategy", () => {
    const s = new MultipartMixedMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Re: Bonjour",
        body: "Avec PJ.",
        inReplyToMessageId: "msg-1@mail.gmail.com",
        attachments: [
          { filename: "a.pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
        ],
      }),
    );
    expect(out).toContain("In-Reply-To: <msg-1@mail.gmail.com>");
    expect(out).toContain("References: <msg-1@mail.gmail.com>");
  });

  it("emits the full References chain when `references` is provided", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Re: Bonjour",
        body: "Suivi #3.",
        inReplyToMessageId: "m3@mail.gmail.com",
        references: "<m1@mail.gmail.com> <m2@mail.gmail.com> <m3@mail.gmail.com>",
      }),
    );
    // In-Reply-To stays the immediate parent only.
    expect(out).toContain("In-Reply-To: <m3@mail.gmail.com>");
    // References carries the full ancestry chain verbatim.
    expect(out).toContain(
      "References: <m1@mail.gmail.com> <m2@mail.gmail.com> <m3@mail.gmail.com>",
    );
  });

  it("falls back to single-id References when `references` is empty/whitespace", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Re: Bonjour",
        body: "Suivi.",
        inReplyToMessageId: "m1@mail.gmail.com",
        references: "   ",
      }),
    );
    expect(out).toContain("References: <m1@mail.gmail.com>");
  });

  it("emits the full chain through the multipart strategy too", () => {
    const s = new MultipartMixedMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Re: Bonjour",
        body: "Avec PJ.",
        inReplyToMessageId: "m2@mail.gmail.com",
        references: "<m1@mail.gmail.com> <m2@mail.gmail.com>",
        attachments: [
          { filename: "a.pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
        ],
      }),
    );
    expect(out).toContain("In-Reply-To: <m2@mail.gmail.com>");
    expect(out).toContain("References: <m1@mail.gmail.com> <m2@mail.gmail.com>");
  });
});

describe("MimeMessageBuilder self Message-ID header", () => {
  it("emits a Message-ID header when selfMessageId is provided (TextOnly)", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Bonjour",
        body: "Salut.",
        selfMessageId: "<uuid-1@acme.com>",
      }),
    );
    expect(out).toContain("Message-ID: <uuid-1@acme.com>");
  });

  it("emits a Message-ID header on the multipart strategy too", () => {
    const s = new MultipartMixedMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Bonjour",
        body: "Salut.",
        selfMessageId: "<uuid-2@acme.com>",
        attachments: [
          { filename: "a.pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
        ],
      }),
    );
    expect(out).toContain("Message-ID: <uuid-2@acme.com>");
  });

  it("adds angle brackets when selfMessageId is unwrapped", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Bonjour",
        body: "Salut.",
        selfMessageId: "uuid-3@acme.com",
      }),
    );
    expect(out).toContain("Message-ID: <uuid-3@acme.com>");
  });

  it("omits the Message-ID header entirely when selfMessageId is absent", () => {
    const s = new TextOnlyMimeStrategy();
    const out = decode(
      s.build({
        from: "rep@acme.com",
        to: "lead@hotel.fr",
        subject: "Bonjour",
        body: "Salut.",
      }),
    );
    expect(out).not.toContain("Message-ID:");
  });
});

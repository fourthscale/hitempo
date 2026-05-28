import { describe, expect, it } from "vitest";

import {
  MimeMessageBuilder,
  MultipartMixedMimeStrategy,
  TextOnlyMimeStrategy,
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

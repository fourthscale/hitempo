import { describe, it, expect } from "vitest";
import { extractSubjectAndBody } from "@/lib/messages/extract-subject";

describe("extractSubjectAndBody", () => {
  describe("LinkedIn channel", () => {
    it("returns the full content as body and null subject", () => {
      const out = extractSubjectAndBody("Hey Sophie, quick note...", "linkedin", "fr");
      expect(out.subject).toBeNull();
      expect(out.body).toBe("Hey Sophie, quick note...");
    });

    it("trims leading/trailing whitespace on body", () => {
      const out = extractSubjectAndBody("   \nLinkedIn DM here\n  ", "linkedin", "en");
      expect(out.body).toBe("LinkedIn DM here");
    });
  });

  describe("Email FR — 'Objet:' format", () => {
    it("extracts subject and body separated by empty line", () => {
      const content = `Objet: Végétalisation de vos espaces\n\nBonjour Sophie,\n\nJ'ai vu...`;
      const out = extractSubjectAndBody(content, "email", "fr");
      expect(out.subject).toBe("Végétalisation de vos espaces");
      expect(out.body).toBe("Bonjour Sophie,\n\nJ'ai vu...");
    });

    it("is case-insensitive on the 'Objet:' marker", () => {
      const out = extractSubjectAndBody(
        "OBJET : Test\n\nCorps",
        "email",
        "fr",
      );
      expect(out.subject).toBe("Test");
      expect(out.body).toBe("Corps");
    });

    it("tolerates missing blank line after subject (just one newline)", () => {
      const out = extractSubjectAndBody(
        "Objet: Test\nCorps direct",
        "email",
        "fr",
      );
      expect(out.subject).toBe("Test");
      expect(out.body).toBe("Corps direct");
    });
  });

  describe("Email EN — 'Subject:' format", () => {
    it("extracts subject and body", () => {
      const out = extractSubjectAndBody(
        "Subject: A clean approach to your lobby\n\nHi Sophie,\n\nI noticed...",
        "email",
        "en",
      );
      expect(out.subject).toBe("A clean approach to your lobby");
      expect(out.body).toBe("Hi Sophie,\n\nI noticed...");
    });
  });

  describe("Graceful degradation when format is off", () => {
    it("returns null subject and full content as body when first line is not 'Objet:' (FR email)", () => {
      const content = `Bonjour Sophie,\n\nJ'ai vu votre rénovation...`;
      const out = extractSubjectAndBody(content, "email", "fr");
      expect(out.subject).toBeNull();
      expect(out.body).toBe(content);
    });

    it("no newline in content → null subject and content as body", () => {
      const out = extractSubjectAndBody("Single line no newline", "email", "fr");
      expect(out.subject).toBeNull();
      expect(out.body).toBe("Single line no newline");
    });

    it("FR locale does not pick up 'Subject:' marker", () => {
      const out = extractSubjectAndBody(
        "Subject: Wrong locale marker\n\nBody",
        "email",
        "fr",
      );
      expect(out.subject).toBeNull();
    });
  });
});

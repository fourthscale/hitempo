import { describe, it, expect } from "vitest";
import { cleanReplySnippet } from "@/lib/messages/clean-reply-snippet";

describe("cleanReplySnippet", () => {
  it("decodes common HTML entities", () => {
    expect(cleanReplySnippet("Oui &gt; non &amp; merci &#39;ok&#39;"))
      .toBe("Oui > non & merci 'ok'");
  });

  it("strips French quoted-reply intro", () => {
    const raw = "Oui des plantes ! Le 28 mai 2026 à 20:55, ludovic@x.com a écrit : > Bonjour";
    expect(cleanReplySnippet(raw)).toBe("Oui des plantes !");
  });

  it("strips English quoted-reply intro", () => {
    const raw = "Sounds great. On May 28, 2026 at 8:55 PM, John wrote: > Hello";
    expect(cleanReplySnippet(raw)).toBe("Sounds great.");
  });

  it("strips on `>` line marker fallback", () => {
    const raw = "Oui ok merci\n> Bonjour, Pour l'accueil hôtelier...";
    expect(cleanReplySnippet(raw)).toBe("Oui ok merci");
  });

  it("strips our own 'Reply:' prefix idempotently", () => {
    expect(cleanReplySnippet("Reply: Hello there")).toBe("Hello there");
    expect(cleanReplySnippet("Réponse : Bonjour")).toBe("Bonjour");
  });

  it("leaves a clean snippet untouched", () => {
    const clean = "Sounds great, let's chat tomorrow at 3pm.";
    expect(cleanReplySnippet(clean)).toBe(clean);
  });

  it("handles empty input", () => {
    expect(cleanReplySnippet("")).toBe("");
  });
});

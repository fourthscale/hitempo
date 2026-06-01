import { describe, expect, it } from "vitest";
import { buildIntentClassificationPrompt } from "@/lib/ai/classification/prompt-builder";

describe("buildIntentClassificationPrompt", () => {
  it("includes all 7 labels in the system prompt", () => {
    const p = buildIntentClassificationPrompt({
      snippet: "Sounds great, let's chat next week.",
      locale: "en",
    });
    for (const label of [
      "positive",
      "negative",
      "out_of_office",
      "wrong_person",
      "unsubscribe",
      "neutral",
      "unknown",
    ]) {
      expect(p.systemPrompt).toContain(label);
    }
  });

  it("instructs the model to return strict JSON", () => {
    const p = buildIntentClassificationPrompt({ snippet: "hi", locale: "en" });
    expect(p.systemPrompt).toMatch(/JSON/);
    expect(p.systemPrompt).toMatch(/"label"/);
    expect(p.systemPrompt).toMatch(/"confidence"/);
    expect(p.systemPrompt).toMatch(/"reasoning"/);
  });

  it("uses FR phrasing for FR snippets", () => {
    const p = buildIntentClassificationPrompt({
      snippet: "Bonjour, intéressé, on en parle ?",
      locale: "fr",
    });
    expect(p.userPrompt).toMatch(/réponse reçue/i);
  });

  it("uses EN phrasing for EN snippets", () => {
    const p = buildIntentClassificationPrompt({
      snippet: "Sounds good.",
      locale: "en",
    });
    expect(p.userPrompt).toMatch(/reply we received/i);
  });

  it("injects the outbound subject line when provided", () => {
    const p = buildIntentClassificationPrompt({
      snippet: "ok",
      locale: "en",
      outboundSubject: "Quick question about your plant policy",
    });
    expect(p.userPrompt).toContain("Quick question about your plant policy");
  });

  it("uses low temperature + tight token budget", () => {
    const p = buildIntentClassificationPrompt({ snippet: "x", locale: "en" });
    expect(p.temperature).toBeLessThanOrEqual(0.2);
    expect(p.maxTokens).toBeLessThanOrEqual(500);
  });
});

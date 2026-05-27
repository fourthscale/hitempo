import { describe, it, expect } from "vitest";
import { annotateMessage, type AnnotationContext } from "@/lib/messages/message-annotator";

const BASE_CTX: AnnotationContext = {
  contactFirstName: "Sophie",
  contactLastName: "Durand",
  contactJobTitle: "F&B Manager",
  companyName: "Hôtel Westminster",
  signalKeywords: ["rénov"],
};

describe("annotateMessage", () => {
  it("returns one plain segment when nothing matches", () => {
    const out = annotateMessage("Bonjour, comment allez-vous?", BASE_CTX);
    expect(out).toEqual([{ kind: "plain", text: "Bonjour, comment allez-vous?" }]);
  });

  it("highlights firstName as personalize", () => {
    const out = annotateMessage("Bonjour Sophie, comment vas-tu?", BASE_CTX);
    expect(out).toEqual([
      { kind: "plain", text: "Bonjour " },
      { kind: "personalize", text: "Sophie" },
      { kind: "plain", text: ", comment vas-tu?" },
    ]);
  });

  it("highlights companyName and signal stem in the same text", () => {
    const out = annotateMessage(
      "J'ai vu que l'Hôtel Westminster prévoit une rénovation.",
      BASE_CTX,
    );
    expect(out).toContainEqual({ kind: "personalize", text: "Hôtel Westminster" });
    expect(out).toContainEqual({ kind: "signal", text: "rénov" });
  });

  it("is case-insensitive on matching but preserves original case", () => {
    const out = annotateMessage("Cher SOPHIE, ça va?", BASE_CTX);
    const personalize = out.filter((s) => s.kind === "personalize");
    expect(personalize).toHaveLength(1);
    expect(personalize[0]!.text).toBe("SOPHIE");
  });

  it("matches multiple occurrences of the same term", () => {
    const out = annotateMessage("Sophie, je t'écris à Sophie.", BASE_CTX);
    const sophies = out.filter((s) => s.kind === "personalize");
    expect(sophies.map((s) => s.text)).toEqual(["Sophie", "Sophie"]);
  });

  it("longest match wins on overlap (companyName beats firstName)", () => {
    const ctx: AnnotationContext = {
      ...BASE_CTX,
      contactFirstName: "Hôtel", // 5 chars
      companyName: "Hôtel Westminster", // 17 chars — longer wins
      signalKeywords: [],
    };
    const out = annotateMessage("L'Hôtel Westminster est rénové.", ctx);
    const personalize = out.filter((s) => s.kind === "personalize");
    expect(personalize.map((s) => s.text)).toEqual(["Hôtel Westminster"]);
  });

  it("returns empty array on empty input", () => {
    expect(annotateMessage("", BASE_CTX)).toEqual([]);
  });

  it("returns a single plain segment when all context fields are empty", () => {
    const out = annotateMessage("hello world", {
      contactFirstName: "",
      contactLastName: "",
      contactJobTitle: null,
      companyName: "",
      signalKeywords: [],
    });
    expect(out).toEqual([{ kind: "plain", text: "hello world" }]);
  });

  it("ignores blank-only personalize fields without crashing", () => {
    const out = annotateMessage("Sophie Durand", {
      ...BASE_CTX,
      contactFirstName: "   ",
      contactLastName: "Durand",
      contactJobTitle: null,
      companyName: "",
      signalKeywords: [],
    });
    const personalize = out.filter((s) => s.kind === "personalize");
    expect(personalize.map((s) => s.text)).toEqual(["Durand"]);
  });

  it("includes jobTitle in matches when present", () => {
    const out = annotateMessage("As F&B Manager you'd know...", BASE_CTX);
    expect(out.find((s) => s.kind === "personalize" && s.text === "F&B Manager")).toBeDefined();
  });

  it("multiple signal stems all highlight independently", () => {
    const out = annotateMessage("Levée de fonds et financement réussis.", {
      ...BASE_CTX,
      contactFirstName: "",
      contactLastName: "",
      contactJobTitle: null,
      companyName: "",
      signalKeywords: ["levée de fonds", "financement"],
    });
    const signals = out.filter((s) => s.kind === "signal");
    expect(signals.map((s) => s.text.toLowerCase())).toEqual([
      "levée de fonds",
      "financement",
    ]);
  });
});

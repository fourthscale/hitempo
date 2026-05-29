import { describe, it, expect } from "vitest";
import {
  resolveLocalizedString,
  isLocalizedStringEmpty,
} from "@/lib/sequences/locale-resolver";

const ctx = (preferred: string, primary = "fr", org = "fr") => ({
  contact: { preferredLanguage: preferred },
  company: { primaryLocale: primary },
  organization: { defaultLocale: org },
});

describe("resolveLocalizedString", () => {
  it("returns a plain string as-is (locale-agnostic)", () => {
    expect(resolveLocalizedString("Bonjour", ctx("fr"))).toBe("Bonjour");
  });

  it("picks the contact's preferred language first", () => {
    const v = { fr: "Bonjour", en: "Hello" };
    expect(resolveLocalizedString(v, ctx("en"))).toBe("Hello");
    expect(resolveLocalizedString(v, ctx("fr"))).toBe("Bonjour");
  });

  it("falls back to company primaryLocale when contact has no variant", () => {
    const v = { fr: "Bonjour", en: "Hello" };
    // contact prefers 'de' (absent) → company 'en'
    expect(resolveLocalizedString(v, ctx("de", "en"))).toBe("Hello");
  });

  it("falls back to org defaultLocale, then default, then any non-empty", () => {
    expect(resolveLocalizedString({ default: "X" }, ctx("de", "es", "it"))).toBe("X");
    expect(resolveLocalizedString({ pt: "P" }, ctx("de", "es", "it"))).toBe("P");
  });

  it("returns empty string when nothing usable", () => {
    expect(resolveLocalizedString({ fr: "" }, ctx("de", "es", "it"))).toBe("");
  });
});

describe("isLocalizedStringEmpty", () => {
  it("true for null/undefined", () => {
    expect(isLocalizedStringEmpty(null, ctx("fr"))).toBe(true);
    expect(isLocalizedStringEmpty(undefined, ctx("fr"))).toBe(true);
  });
  it("true for whitespace-only resolution", () => {
    expect(isLocalizedStringEmpty({ fr: "   " }, ctx("fr"))).toBe(true);
  });
  it("false when resolvable", () => {
    expect(isLocalizedStringEmpty({ fr: "Bonjour" }, ctx("fr"))).toBe(false);
  });
});

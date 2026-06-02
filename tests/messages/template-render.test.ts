import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  extractReferencedVariables,
} from "@/lib/messages/template-render";

describe("renderTemplate", () => {
  it("substitutes a known variable", () => {
    const r = renderTemplate("Bonjour {{contact.firstName}}", {
      "contact.firstName": "Marie",
    });
    expect(r.text).toBe("Bonjour Marie");
    expect(r.missingVariables).toEqual([]);
    expect(r.unknownVariables).toEqual([]);
  });

  it("empty/missing variable without fallback → empty string + tracked as missing", () => {
    const r = renderTemplate("Bonjour {{contact.firstName}},", {
      "contact.firstName": "",
    });
    expect(r.text).toBe("Bonjour ,");
    expect(r.missingVariables).toEqual(["contact.firstName"]);
  });

  it("empty/missing variable with fallback → fallback substituted, NOT tracked as missing", () => {
    const r = renderTemplate("Bonjour {{contact.firstName || 'cher client'}}", {
      "contact.firstName": null,
    });
    expect(r.text).toBe("Bonjour cher client");
    expect(r.missingVariables).toEqual([]);
  });

  it("non-empty variable with fallback → variable wins", () => {
    const r = renderTemplate("Bonjour {{contact.firstName || 'cher client'}}", {
      "contact.firstName": "Marie",
    });
    expect(r.text).toBe("Bonjour Marie");
  });

  it("whitespace-only value treated as missing", () => {
    const r = renderTemplate("Bonjour {{contact.firstName || 'cher client'}}", {
      "contact.firstName": "   ",
    });
    expect(r.text).toBe("Bonjour cher client");
  });

  it("supports double-quoted fallback", () => {
    const r = renderTemplate('Bonjour {{contact.firstName || "vous"}}', {});
    expect(r.text).toBe("Bonjour vous");
  });

  it("supports empty fallback", () => {
    const r = renderTemplate("Salut{{contact.firstName || ''}} !", {});
    expect(r.text).toBe("Salut !");
    expect(r.missingVariables).toEqual([]);
  });

  it("unknown variable left as-is + tracked", () => {
    const r = renderTemplate("Bonjour {{contact.totalAchat}}", {});
    expect(r.text).toBe("Bonjour {{contact.totalAchat}}");
    expect(r.unknownVariables).toEqual(["contact.totalAchat"]);
    expect(r.missingVariables).toEqual([]);
  });

  it("tolerates whitespace inside braces", () => {
    const r = renderTemplate("Bonjour {{  contact.firstName  ||  'cher'  }}", {});
    expect(r.text).toBe("Bonjour cher");
  });

  it("handles multiple placeholders in the same string", () => {
    const r = renderTemplate(
      "Bonjour {{contact.firstName}}, j'ai vu que {{company.name}} se développe.",
      { "contact.firstName": "Marie", "company.name": "Hôtel Costes" },
    );
    expect(r.text).toBe("Bonjour Marie, j'ai vu que Hôtel Costes se développe.");
  });

  it("missing tracked only once even if referenced multiple times", () => {
    const r = renderTemplate(
      "{{contact.firstName}} {{contact.firstName}}",
      {},
    );
    expect(r.missingVariables).toEqual(["contact.firstName"]);
  });

  it("empty template returns empty result", () => {
    const r = renderTemplate("", {});
    expect(r.text).toBe("");
    expect(r.missingVariables).toEqual([]);
    expect(r.unknownVariables).toEqual([]);
  });

  it("leaves plain text untouched when no placeholders", () => {
    const r = renderTemplate("Bonjour cher client,", {});
    expect(r.text).toBe("Bonjour cher client,");
  });
});

describe("extractReferencedVariables", () => {
  it("lists known + unknown separately", () => {
    const r = extractReferencedVariables(
      "{{contact.firstName}} works at {{company.name}} ({{contact.totalAchat}})",
    );
    expect(r.known).toEqual(["contact.firstName", "company.name"]);
    expect(r.unknown).toEqual(["contact.totalAchat"]);
  });

  it("preserves order and duplicates", () => {
    const r = extractReferencedVariables(
      "{{contact.firstName}} {{contact.firstName}} {{company.name}}",
    );
    expect(r.known).toEqual([
      "contact.firstName",
      "contact.firstName",
      "company.name",
    ]);
  });

  it("returns empty arrays for plain text", () => {
    const r = extractReferencedVariables("just plain text");
    expect(r.known).toEqual([]);
    expect(r.unknown).toEqual([]);
  });
});

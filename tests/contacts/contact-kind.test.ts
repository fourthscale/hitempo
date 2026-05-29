import { describe, expect, it } from "vitest";

import {
  buildContactBodySchema,
  resolveContactDisplayName,
  isGenericContact,
} from "@/lib/contacts/contact-kind";

describe("resolveContactDisplayName", () => {
  it("returns 'First Last' for a person", () => {
    expect(
      resolveContactDisplayName({ kind: "person", firstName: "Sophie", lastName: "Martin" }),
    ).toBe("Sophie Martin");
  });

  it("returns whichever name part exists for a person", () => {
    expect(
      resolveContactDisplayName({ kind: "person", firstName: "Sophie", lastName: null }),
    ).toBe("Sophie");
  });

  it("falls back to email for a person with no name", () => {
    expect(
      resolveContactDisplayName({
        kind: "person",
        firstName: null,
        lastName: null,
        email: "s@hotel.fr",
      }),
    ).toBe("s@hotel.fr");
  });

  it("uses email as the label for a generic contact", () => {
    expect(
      resolveContactDisplayName({
        kind: "generic",
        firstName: null,
        lastName: null,
        email: "info@hotelwestminster.com",
      }),
    ).toBe("info@hotelwestminster.com");
  });

  it("uses phone when a generic contact has no email", () => {
    expect(
      resolveContactDisplayName({
        kind: "generic",
        firstName: null,
        lastName: null,
        email: null,
        phone: "+33123456789",
      }),
    ).toBe("+33123456789");
  });

  it("uses the provided genericFallback as last resort", () => {
    expect(
      resolveContactDisplayName(
        { kind: "generic", firstName: null, lastName: null },
        { genericFallback: "Contact générique" },
      ),
    ).toBe("Contact générique");
  });

  it("treats a null kind as a person (legacy safety)", () => {
    expect(
      resolveContactDisplayName({ kind: null, firstName: "Jean", lastName: "Dupont" }),
    ).toBe("Jean Dupont");
  });
});

describe("isGenericContact", () => {
  it("is true only for generic", () => {
    expect(isGenericContact({ kind: "generic" })).toBe(true);
    expect(isGenericContact({ kind: "person" })).toBe(false);
    expect(isGenericContact({ kind: null })).toBe(false);
  });
});

describe("buildContactBodySchema invariants", () => {
  const schema = buildContactBodySchema();
  const base = { companyId: "11111111-1111-4111-8111-111111111111" };

  it("accepts a person with first + last name", () => {
    const r = schema.safeParse({ ...base, kind: "person", firstName: "Sophie", lastName: "Martin" });
    expect(r.success).toBe(true);
  });

  it("rejects a person missing the last name", () => {
    const r = schema.safeParse({ ...base, kind: "person", firstName: "Sophie", lastName: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("lastName"))).toBe(true);
    }
  });

  it("accepts a generic contact with just an email", () => {
    const r = schema.safeParse({ ...base, kind: "generic", email: "info@hotel.fr" });
    expect(r.success).toBe(true);
  });

  it("accepts a generic contact with just a phone", () => {
    const r = schema.safeParse({ ...base, kind: "generic", phone: "+33123456789" });
    expect(r.success).toBe(true);
  });

  it("rejects a generic contact with no channel", () => {
    const r = schema.safeParse({ ...base, kind: "generic", firstName: "", lastName: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "channel_required")).toBe(true);
    }
  });

  it("defaults kind to person when omitted", () => {
    const r = schema.safeParse({ ...base, firstName: "Sophie", lastName: "Martin" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("person");
  });
});

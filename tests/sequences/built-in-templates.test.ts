import { describe, it, expect } from "vitest";
import {
  BUILT_IN_TEMPLATES,
  getBuiltInTemplate,
} from "@/lib/sequences/built-in-templates";
import { draftDefinitionSchema, validateDraftGraph } from "@/lib/sequences/draft-schema";

describe("built-in templates", () => {
  it("exposes three templates with unique slugs", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(3);
    const slugs = BUILT_IN_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(3);
  });

  it("getBuiltInTemplate resolves by slug", () => {
    expect(getBuiltInTemplate("hotel-first-contact")?.slug).toBe("hotel-first-contact");
    expect(getBuiltInTemplate("nope")).toBeUndefined();
  });

  it.each(BUILT_IN_TEMPLATES.map((t) => [t.slug, t] as const))(
    "%s parses the draft schema and passes graph validation",
    (_slug, template) => {
      const parsed = draftDefinitionSchema.safeParse(template.draft);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(validateDraftGraph(parsed.data)).toEqual([]);
      }
    },
  );

  it("matches the documented step counts", () => {
    expect(getBuiltInTemplate("hotel-first-contact")!.draft.steps).toHaveLength(5);
    expect(getBuiltInTemplate("office-wellness")!.draft.steps).toHaveLength(5);
    expect(getBuiltInTemplate("agency-onboarding")!.draft.steps).toHaveLength(3);
  });
});

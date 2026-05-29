import { describe, it, expect } from "vitest";
import {
  matchesTargeting,
  type SequenceTargetingRules,
  type TargetingFacts,
} from "@/lib/sequences/targeting";

const noRestriction: SequenceTargetingRules = {
  targetRelationshipTypes: [],
  targetSiteTypes: [],
  targetContactRoles: [],
  targetLocales: [],
  excludeIfCompanyRelationshipIn: [],
};

const facts: TargetingFacts = {
  companyRelationshipType: "prospect",
  companySiteTypes: ["hotel"],
  contactRole: "decision_maker",
  locale: "fr",
};

describe("matchesTargeting", () => {
  it("matches everything when no rules set", () => {
    expect(matchesTargeting(noRestriction, facts)).toBe(true);
  });

  it("restricts by relationship type", () => {
    expect(
      matchesTargeting({ ...noRestriction, targetRelationshipTypes: ["prospect"] }, facts),
    ).toBe(true);
    expect(
      matchesTargeting({ ...noRestriction, targetRelationshipTypes: ["client"] }, facts),
    ).toBe(false);
  });

  it("hard-excludes by company relationship", () => {
    expect(
      matchesTargeting(
        { ...noRestriction, excludeIfCompanyRelationshipIn: ["prospect"] },
        facts,
      ),
    ).toBe(false);
  });

  it("exclusion overrides an explicit include", () => {
    expect(
      matchesTargeting(
        {
          ...noRestriction,
          targetRelationshipTypes: ["prospect"],
          excludeIfCompanyRelationshipIn: ["prospect"],
        },
        facts,
      ),
    ).toBe(false);
  });

  it("restricts by contact role and locale", () => {
    expect(matchesTargeting({ ...noRestriction, targetContactRoles: ["decision_maker"] }, facts)).toBe(true);
    expect(matchesTargeting({ ...noRestriction, targetContactRoles: ["influencer"] }, facts)).toBe(false);
    expect(matchesTargeting({ ...noRestriction, targetLocales: ["en"] }, facts)).toBe(false);
  });

  it("a restricted axis with a null fact does not match", () => {
    expect(
      matchesTargeting(
        { ...noRestriction, targetContactRoles: ["decision_maker"] },
        { ...facts, contactRole: null },
      ),
    ).toBe(false);
  });

  it("matches site types when the company has at least one matching site", () => {
    expect(matchesTargeting({ ...noRestriction, targetSiteTypes: ["hotel"] }, facts)).toBe(true);
    expect(matchesTargeting({ ...noRestriction, targetSiteTypes: ["office"] }, facts)).toBe(false);
    expect(
      matchesTargeting(
        { ...noRestriction, targetSiteTypes: ["office", "hotel"] },
        { ...facts, companySiteTypes: ["restaurant", "hotel"] },
      ),
    ).toBe(true);
  });
});

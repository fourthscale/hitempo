import { describe, it, expect } from "vitest";
import {
  SequenceEligibilityChecker,
  type SequenceEligibilityContext,
} from "@/lib/sequences/eligibility-checker";

const NOW = new Date("2026-03-01T00:00:00Z");

function base(over: Partial<SequenceEligibilityContext> = {}): SequenceEligibilityContext {
  return {
    contactOptedOut: false,
    contactHasActiveEnrolment: false,
    companyHasActiveEnrolment: false,
    mostRecentCompletedAt: null,
    now: NOW,
    ...over,
  };
}

describe("SequenceEligibilityChecker", () => {
  const checker = new SequenceEligibilityChecker();

  it("eligible when no guard trips", () => {
    expect(checker.check(base())).toEqual({ eligible: true });
  });

  it("opt-out is a hard reject and takes priority", () => {
    const verdict = checker.check(
      base({ contactOptedOut: true, contactHasActiveEnrolment: true }),
    );
    expect(verdict).toEqual({ eligible: false, reason: "opted_out" });
  });

  it("rejects active enrolment on the contact", () => {
    expect(checker.check(base({ contactHasActiveEnrolment: true }))).toEqual({
      eligible: false,
      reason: "active_enrolment_on_contact",
    });
  });

  it("rejects active enrolment on the company", () => {
    expect(checker.check(base({ companyHasActiveEnrolment: true }))).toEqual({
      eligible: false,
      reason: "active_enrolment_on_company",
    });
  });

  it("rejects within the cooldown window", () => {
    const completed = new Date(NOW.getTime() - 10 * 86_400_000); // 10 days ago
    expect(checker.check(base({ mostRecentCompletedAt: completed }))).toEqual({
      eligible: false,
      reason: "cooldown",
    });
  });

  it("allows after the cooldown window elapses", () => {
    const completed = new Date(NOW.getTime() - 40 * 86_400_000); // 40 days ago
    expect(checker.check(base({ mostRecentCompletedAt: completed }))).toEqual({
      eligible: true,
    });
  });

  it("respects a custom cooldown window", () => {
    const lenient = new SequenceEligibilityChecker({ cooldownDays: 7 });
    const completed = new Date(NOW.getTime() - 10 * 86_400_000);
    expect(lenient.check(base({ mostRecentCompletedAt: completed }))).toEqual({
      eligible: true,
    });
  });
});

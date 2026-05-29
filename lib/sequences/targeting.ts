/**
 * Pure targeting matcher : decides whether a contact/company pair falls within
 * a sequence's targeting rules. Kept free of DB access so it is unit-testable
 * and reusable from both the auto-enrol service and the editor preview.
 *
 * Each `target*` array uses the convention: EMPTY = no restriction on that
 * axis. A non-empty array restricts to its members. `excludeIfCompanyRelationshipIn`
 * is a hard exclusion regardless of the include rules.
 */

export type SequenceTargetingRules = {
  targetRelationshipTypes: string[];
  targetSiteTypes: string[];
  targetContactRoles: string[];
  targetLocales: string[];
  excludeIfCompanyRelationshipIn: string[];
};

export type TargetingFacts = {
  companyRelationshipType: string | null;
  /** All site types attached to the company (empty if none). */
  companySiteTypes: string[];
  contactRole: string | null;
  /** Effective locale for the contact (preferred language, fallbacks applied upstream). */
  locale: string | null;
};

function includedBy(rule: string[], value: string | null): boolean {
  if (rule.length === 0) return true; // no restriction
  if (value == null) return false; // restricted axis but contact has no value
  return rule.includes(value);
}

export function matchesTargeting(rules: SequenceTargetingRules, facts: TargetingFacts): boolean {
  // Hard exclusion first.
  if (
    facts.companyRelationshipType != null &&
    rules.excludeIfCompanyRelationshipIn.includes(facts.companyRelationshipType)
  ) {
    return false;
  }

  if (!includedBy(rules.targetRelationshipTypes, facts.companyRelationshipType)) return false;
  if (!includedBy(rules.targetContactRoles, facts.contactRole)) return false;
  if (!includedBy(rules.targetLocales, facts.locale)) return false;

  // Site types : empty rule = no restriction ; otherwise the company must have
  // at least one site whose type is in the rule.
  if (rules.targetSiteTypes.length > 0) {
    const hasMatchingSite = facts.companySiteTypes.some((t) => rules.targetSiteTypes.includes(t));
    if (!hasMatchingSite) return false;
  }

  return true;
}

/**
 * Composite condition model (Klaviyo-style AND/OR builder) for sequence
 * branching (conditional_split / conditional_switch).
 *
 * A condition is a recursive tree : a GROUP (`and` / `or`) of children, each of
 * which is either a leaf (`dimension operator value`) or a nested group. The
 * evaluator is pure — it reads a flat `ConditionFacts` snapshot the engine
 * builds from the enrolment context — so it stays unit-testable without a DB.
 */

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ConditionLeaf = {
  kind: "leaf";
  dimension: string;
  operator: string;
  value?: string;
};

export type ConditionGroup = {
  kind: "group";
  op: "and" | "or";
  conditions: Condition[];
};

export type Condition = ConditionLeaf | ConditionGroup;

export const emptyGroup = (): ConditionGroup => ({ kind: "group", op: "and", conditions: [] });

// ---------------------------------------------------------------------------
// Dimension catalogue (what the builder offers + how each is evaluated)
// ---------------------------------------------------------------------------

export type DimensionType = "enum" | "text" | "boolean" | "behavior";
export type DimensionCategory = "contact" | "company" | "behavior";

export type DimensionDef = {
  key: string;
  category: DimensionCategory;
  type: DimensionType;
  /** Allowed values for enum dimensions (used to render a value <select>). */
  values?: readonly string[];
};

const CONTACT_STATUSES = ["to_contact", "to_follow_up", "qualified", "not_interested"] as const;
const CONTACT_ROLES = ["decision_maker", "influencer", "user", "prescriber", "assistant", "other"] as const;
const RELATIONSHIP_TYPES = ["prospect", "client", "former_client", "prescriber", "partner"] as const;
const LOCALES = ["fr", "en"] as const;

export const DIMENSIONS: DimensionDef[] = [
  { key: "contact.status", category: "contact", type: "enum", values: CONTACT_STATUSES },
  { key: "contact.role", category: "contact", type: "enum", values: CONTACT_ROLES },
  { key: "contact.preferredLanguage", category: "contact", type: "enum", values: LOCALES },
  { key: "contact.optedOut", category: "contact", type: "boolean" },
  { key: "contact.jobTitle", category: "contact", type: "text" },
  { key: "company.relationshipType", category: "company", type: "enum", values: RELATIONSHIP_TYPES },
  { key: "company.signalType", category: "company", type: "text" },
  { key: "behavior.replied", category: "behavior", type: "behavior" },
  { key: "behavior.positiveReply", category: "behavior", type: "behavior" },
  { key: "behavior.negativeReply", category: "behavior", type: "behavior" },
  { key: "behavior.callNoAnswer", category: "behavior", type: "behavior" },
];

export const DIMENSION_BY_KEY: Record<string, DimensionDef> = Object.fromEntries(
  DIMENSIONS.map((d) => [d.key, d]),
);

export const OPERATORS_BY_TYPE: Record<DimensionType, readonly string[]> = {
  enum: ["equals", "not_equals", "is_set", "is_not_set"],
  text: ["equals", "not_equals", "contains", "is_set", "is_not_set"],
  boolean: ["is_true", "is_false"],
  behavior: ["happened", "not_happened"],
};

/** Operators that need no value input. */
export const VALUELESS_OPERATORS = new Set([
  "is_set",
  "is_not_set",
  "is_true",
  "is_false",
  "happened",
  "not_happened",
]);

// ---------------------------------------------------------------------------
// Facts + evaluation
// ---------------------------------------------------------------------------

export type ConditionFacts = {
  contact: {
    status: string | null;
    role: string | null;
    preferredLanguage: string | null;
    optedOut: boolean;
    jobTitle: string | null;
  };
  company: {
    relationshipType: string | null;
    signalType: string | null;
  };
  behavior: {
    replied: boolean;
    positiveReply: boolean;
    negativeReply: boolean;
    callNoAnswer: boolean;
  };
};

function resolve(facts: ConditionFacts, key: string): unknown {
  const [group, field] = key.split(".");
  if (group == null || field == null) return undefined;
  const bag = (facts as unknown as Record<string, Record<string, unknown>>)[group];
  return bag ? bag[field] : undefined;
}

function evaluateLeaf(leaf: ConditionLeaf, facts: ConditionFacts): boolean {
  const def = DIMENSION_BY_KEY[leaf.dimension];
  if (!def) return false;
  const raw = resolve(facts, leaf.dimension);

  switch (def.type) {
    case "enum":
    case "text": {
      const v = raw == null ? null : String(raw);
      switch (leaf.operator) {
        case "equals":
          return v === leaf.value;
        case "not_equals":
          return v !== leaf.value;
        case "is_set":
          return v != null && v !== "";
        case "is_not_set":
          return v == null || v === "";
        case "contains":
          return Boolean(v && leaf.value && v.toLowerCase().includes(leaf.value.toLowerCase()));
        default:
          return false;
      }
    }
    case "boolean": {
      const b = Boolean(raw);
      return leaf.operator === "is_true" ? b : !b;
    }
    case "behavior": {
      const b = Boolean(raw);
      return leaf.operator === "not_happened" ? !b : b;
    }
  }
}

/**
 * Evaluate a condition tree against a facts snapshot. An empty group is
 * vacuously true (no constraint), so a brand-new split routes everyone to YES
 * until the author adds a condition.
 */
export function evaluateConditionGroup(group: ConditionGroup, facts: ConditionFacts): boolean {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((c) =>
    c.kind === "group" ? evaluateConditionGroup(c, facts) : evaluateLeaf(c, facts),
  );
  return group.op === "and" ? results.every(Boolean) : results.some(Boolean);
}

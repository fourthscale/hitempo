/**
 * Sprint 12 — Defined-message templating
 *
 * Single source of truth for what variables a sale can insert in a
 * `send_email` step's subject/body when the step is in `defined` mode.
 *
 * Syntax (Klaviyo-style) :
 *   {{contact.firstName}}                          → "" if missing
 *   {{contact.firstName || 'cher client'}}         → fallback if missing/empty
 *
 * The variable namespace stays TS-style camelCase to match every other
 * domain key in the codebase ; the UI presents human labels via i18n
 * (e.g. "Prénom du contact" → inserts `{{contact.firstName}}`).
 *
 * Adding a variable is a 3-touch change : add it here, expose its resolver
 * in `template-render.ts` via the `TemplateFacts` shape, and add the
 * i18n label under `messages.templateVariables.*`.
 */

export type TemplateVariableKey =
  | "contact.firstName"
  | "contact.lastName"
  | "contact.fullName"
  | "contact.jobTitle"
  | "company.name"
  | "company.signalType"
  | "sender.firstName"
  | "sender.lastName"
  | "sender.fullName";

export type TemplateVariableCategory = "contact" | "company" | "sender";

export type TemplateVariableDef = {
  key: TemplateVariableKey;
  category: TemplateVariableCategory;
  /** i18n key under `templateVariables.labels` (UI-displayed name). */
  labelKey: string;
  /** Example value the preview renders when no real data exists. */
  sample: string;
};

export const TEMPLATE_VARIABLES: readonly TemplateVariableDef[] = [
  { key: "contact.firstName", category: "contact", labelKey: "contact.firstName", sample: "Marie" },
  { key: "contact.lastName",  category: "contact", labelKey: "contact.lastName",  sample: "Dupont" },
  { key: "contact.fullName",  category: "contact", labelKey: "contact.fullName",  sample: "Marie Dupont" },
  { key: "contact.jobTitle",  category: "contact", labelKey: "contact.jobTitle",  sample: "Directrice marketing" },
  { key: "company.name",       category: "company", labelKey: "company.name",       sample: "Hôtel Costes" },
  { key: "company.signalType", category: "company", labelKey: "company.signalType", sample: "ouverture récente" },
  { key: "sender.firstName", category: "sender", labelKey: "sender.firstName", sample: "Lucie" },
  { key: "sender.lastName",  category: "sender", labelKey: "sender.lastName",  sample: "Martin" },
  { key: "sender.fullName",  category: "sender", labelKey: "sender.fullName",  sample: "Lucie Martin" },
];

const VALID_KEYS = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.key));

export function isTemplateVariableKey(s: string): s is TemplateVariableKey {
  return VALID_KEYS.has(s);
}

export const TEMPLATE_VARIABLES_BY_CATEGORY: Record<
  TemplateVariableCategory,
  readonly TemplateVariableDef[]
> = {
  contact: TEMPLATE_VARIABLES.filter((v) => v.category === "contact"),
  company: TEMPLATE_VARIABLES.filter((v) => v.category === "company"),
  sender: TEMPLATE_VARIABLES.filter((v) => v.category === "sender"),
};

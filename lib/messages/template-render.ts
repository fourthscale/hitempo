/**
 * Sprint 12 — Pure template renderer.
 *
 * Parses `{{path[ || 'fallback']}}` placeholders in arbitrary text and
 * substitutes them against a `TemplateFacts` snapshot. Klaviyo-inspired
 * syntax :
 *
 *   {{contact.firstName}}                     → fact value, or "" if empty/missing
 *   {{contact.firstName || 'cher client'}}    → fallback when empty/missing
 *   {{sender.fullName || ""}}                  → explicit empty fallback (same as none)
 *
 * Rules :
 *   - Variable path : dot-separated keys (e.g. `contact.firstName`).
 *   - Unknown variable path  → leaves the raw `{{...}}` in place + lists
 *     the key in `unknownVariables` so the UI can warn.
 *   - Empty/null fact value → substitutes with the fallback if given,
 *     else empty string.
 *   - Fallback value : single OR double quoted string, no escaping needed.
 *   - Whitespace tolerant around `||` and inside braces.
 *
 * Pure : no DB, no i18n, no clock. Same input → same output. Tests live
 * next to the file.
 */

import {
  isTemplateVariableKey,
  type TemplateVariableKey,
} from "./template-variables";

/** Snapshot the renderer reads against. Only known keys are honored ;
 *  the type union (`TemplateVariableKey`) keeps the contract narrow. */
export type TemplateFacts = Partial<Record<TemplateVariableKey, string | null | undefined>>;

export type RenderResult = {
  /** Final text after all known placeholders are substituted. */
  text: string;
  /** Variable keys referenced but missing (or empty) AND without a
   *  fallback. Useful for surfacing "this draft will look incomplete". */
  missingVariables: string[];
  /** Variable keys referenced but not in `TEMPLATE_VARIABLES` (typos,
   *  removed vars). The UI shows these in red. */
  unknownVariables: string[];
};

// `{{ path [ || 'fallback' ] }}`
//   - path  : group 1, [\w.] (dot-separated keys)
//   - quote : group 2 (the quote char), used to also accept "..." double-quoted
//   - value : group 3 (fallback content, may be empty)
//   - `?:` non-capturing wrappers ; `s` flag NOT needed (single-line)
const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*(?:\|\|\s*(['"])([^'"]*)\2\s*)?\}\}/g;

export function renderTemplate(template: string, facts: TemplateFacts): RenderResult {
  if (!template) return { text: "", missingVariables: [], unknownVariables: [] };

  const missing = new Set<string>();
  const unknown = new Set<string>();

  const text = template.replace(PLACEHOLDER_RE, (raw, path: string, _quote, fallback?: string) => {
    if (!isTemplateVariableKey(path)) {
      unknown.add(path);
      return raw; // leave as-is so the sale spots the typo
    }
    const value = facts[path as TemplateVariableKey];
    const v = typeof value === "string" ? value.trim() : "";
    if (v.length > 0) return v;
    if (typeof fallback === "string") return fallback;
    missing.add(path);
    return "";
  });

  return {
    text,
    missingVariables: Array.from(missing),
    unknownVariables: Array.from(unknown),
  };
}

/** Extracts the set of variable keys referenced by a template (with or
 *  without fallback), in the order they appear, with duplicates kept.
 *  Used by the editor preview / lint to show which facts will be needed. */
export function extractReferencedVariables(template: string): {
  known: TemplateVariableKey[];
  unknown: string[];
} {
  const known: TemplateVariableKey[] = [];
  const unknown: string[] = [];
  if (!template) return { known, unknown };
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(template)) !== null) {
    const path = m[1]!;
    if (isTemplateVariableKey(path)) known.push(path);
    else unknown.push(path);
  }
  return { known, unknown };
}

/**
 * Brand brief — per-organization, per-locale brand voice configuration.
 *
 * Used as system-prompt input for AI message generation (sprint 07) and
 * for any future AI feature that needs to speak in the brand's voice.
 *
 * Stored on `organizations.brand_brief` as JSONB. Both locales are optional
 * but at least one must be present to enable generation in that locale.
 */
export type BrandBriefLocale = {
  /** 1-2 sentences : who you are and for whom. Backbone of the system prompt. */
  positioning: string;
  /** Adjectives describing the voice : ["warm", "expert", "concise"]. */
  toneOfVoice: string[];
  /** Words and phrases the AI must never use : ["cheap", "discount", "guys"]. */
  forbiddenWords: string[];
  /** Brand-specific expressions to favor : ["végétal vivant", "expertise paysagère"]. */
  signatureExpressions: string[];
  /** 3-5 bullet arguments. */
  valueProps: string[];
  /** Social proof points the AI may reference : ["Le Bristol", "Plaza Athénée"]. */
  proofPoints: string[];
};

export type BrandBrief = {
  fr?: BrandBriefLocale;
  en?: BrandBriefLocale;
};

/** Empty default — typed JSONB default for the `brand_brief` column. */
export const EMPTY_BRAND_BRIEF: BrandBrief = {};

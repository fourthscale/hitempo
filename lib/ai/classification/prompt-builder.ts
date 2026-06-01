/**
 * Pure builder for the inbound-reply classification prompt.
 *
 * Separated from the classifier service so it stays unit-testable without
 * any LLM dependency. Returns a `GenerateInput` compatible with the
 * shared `LlmStrategy` contract.
 *
 * Locale switches the user-prompt language so the model reasons in the
 * snippet's language ; the SYSTEM contract (output JSON shape, label set)
 * stays English to keep parsing deterministic across locales.
 */

import type { GenerateInput } from "@/lib/ai/llm-strategy";
import { INTENT_LABELS } from "./intent-labels";

export type IntentClassificationLocale = "fr" | "en";

export type IntentClassificationInput = {
  /** The cleaned-up snippet of the reply (≤ a few hundred chars). */
  snippet: string;
  /** Language the reply is written in (matches contact preferredLanguage). */
  locale: IntentClassificationLocale;
  /** Optional subject line of the original outbound — adds context. */
  outboundSubject?: string | null;
};

const LABEL_LIST = INTENT_LABELS.join(" | ");

const SYSTEM_PROMPT = `You are an email-reply classifier embedded in a B2B sales CRM.

Your job : read a short inbound reply snippet and return ONE label from this exact set:
  ${LABEL_LIST}

Definitions:
  - "positive"      : sender shows interest (asks a question, requests info, books a meeting, wants to talk).
  - "negative"      : explicit refusal, not interested, "no thanks".
  - "out_of_office" : auto-reply about absence (vacation, parental leave, OOO).
  - "wrong_person"  : "I'm not the right person", "contact X instead".
  - "unsubscribe"   : explicit unsubscribe / opt-out / GDPR removal request.
  - "neutral"       : polite acknowledgment with no clear yes/no ("thanks, I'll look at it").
  - "unknown"       : the snippet is too short, ambiguous, or you cannot decide.

You MUST return a JSON object with these exact keys and no extra fields:
  {
    "label": "<one of the labels above>",
    "confidence": <number between 0 and 1, two decimals>,
    "reasoning": "<one short sentence, ≤ 140 chars, in English>"
  }

Rules:
  - Never invent labels outside the set.
  - When unsure, prefer "unknown" with low confidence over guessing.
  - Confidence reflects YOUR certainty, not the sender's enthusiasm.
  - Output VALID JSON only — no markdown fences, no prose around it.`;

function buildUserPrompt(input: IntentClassificationInput): string {
  const subjectLine = input.outboundSubject
    ? input.locale === "fr"
      ? `Objet du message envoyé : "${input.outboundSubject}"\n\n`
      : `Original outbound subject: "${input.outboundSubject}"\n\n`
    : "";

  if (input.locale === "fr") {
    return `${subjectLine}Voici la réponse reçue (français possible) :

"""
${input.snippet}
"""

Classe-la selon les règles ci-dessus. Réponds uniquement avec l'objet JSON.`;
  }

  return `${subjectLine}Here is the reply we received:

"""
${input.snippet}
"""

Classify it according to the rules above. Respond with the JSON object only.`;
}

export function buildIntentClassificationPrompt(
  input: IntentClassificationInput,
): GenerateInput {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(input),
    // Classification is deterministic-ish ; low temperature, tight token budget.
    temperature: 0.1,
    maxTokens: 200,
  };
}

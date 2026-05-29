/**
 * Pure function : builds a provider-agnostic { systemPrompt, userPrompt }
 * for outbound message generation.
 *
 * No DB access, no LLM SDK call, no I/O. Takes a fully resolved context
 * and returns two strings. The strings are then handed to an LlmStrategy
 * via the LlmGenerationService.
 *
 * Anything that affects what the model says lives here — the system prompt
 * fully scopes the brand voice and formatting, and the user prompt scopes
 * the specific prospect.
 */

import type { BrandBriefLocale } from "@/lib/brand/brand-brief";
import type {
  MessageChannel,
  MessageIntent,
  MessageLocale,
} from "@/lib/messages/types";

export type OutboundMessageContext = {
  brandBrief: BrandBriefLocale;
  company: {
    name: string;
    industry: string | null;
    standing: number | null;
    score: number | null;
  };
  /** Provided only when the user toggled "include signal" ON. */
  signal: { type: string; detectedAt: Date; ageDays: number } | null;
  contact: {
    /** "generic" contacts (info@…) have no personal name — the prompt
     *  instructs a neutral salutation instead of a first-name greeting. */
    kind: "person" | "generic";
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    preferredLanguage: string;
    relevance: number | null;
  };
  interactions: Array<{
    occurredAt: Date;
    type: string;
    channel: string;
    outcome: string | null;
    summary: string | null;
    interestLevel: number | null;
  }>;
  previousMessages: Array<{
    createdAt: Date;
    channel: MessageChannel;
    intent: MessageIntent;
    content: string;
  }>;
  sender: { firstName: string; lastName: string };
  intent: MessageIntent;
  channel: MessageChannel;
  locale: MessageLocale;
  /** Optional user note injected verbatim ("plus court", "mentionne la rénovation"). */
  orientation?: string;
};

export function buildOutboundMessagePrompt(ctx: OutboundMessageContext): {
  systemPrompt: string;
  userPrompt: string;
} {
  return ctx.locale === "fr" ? buildFrench(ctx) : buildEnglish(ctx);
}

// ---------------------------------------------------------------------------
// French templates
// ---------------------------------------------------------------------------

function buildFrench(ctx: OutboundMessageContext) {
  const brand = ctx.brandBrief;

  const systemSections: string[] = [
    `Tu es un assistant de rédaction commerciale.`,
    "",
    `Positionnement de la marque : ${brand.positioning}`,
    "",
    `Voix et ton :`,
    `- Ton : ${brand.toneOfVoice.join(", ") || "(non spécifié)"}`,
    `- Expressions signature à privilégier : ${formatInline(brand.signatureExpressions)}`,
    `- Mots et expressions à éviter absolument : ${formatInline(brand.forbiddenWords)}`,
    "",
    `Arguments de valeur disponibles :`,
    formatBullets(brand.valueProps),
    "",
    `Preuves sociales mobilisables :`,
    formatBullets(brand.proofPoints),
    "",
    `Contraintes de format pour ce message :`,
    ctx.channel === "email"
      ? [
          `- Email : 80 à 150 mots dans le corps`,
          `- Première ligne EXACTEMENT au format : "Objet: <ton objet>"`,
          `- Ligne vide après l'objet`,
          `- Puis le corps du message`,
        ].join("\n")
      : `- LinkedIn DM : max 300 caractères, pas d'objet, pas de salutation formelle`,
    `- Langue : français`,
    `- Pas de mention de prix`,
    `- Signature : ${ctx.sender.firstName} ${ctx.sender.lastName}`,
    `- Ne jamais inventer un proof point absent de la liste ci-dessus`,
    `- Ne jamais répéter une phrase mot pour mot d'un message précédent`,
  ];

  if (!ctx.signal) {
    systemSections.push(
      `- Ne PAS inventer de signal ou d'événement (rénovation, ouverture, levée de fonds, etc.) si aucun n'est fourni dans le contexte ci-dessous`,
    );
  }

  if (ctx.contact.kind === "generic") {
    systemSections.push(
      `- Le contact est une adresse générique (pas de personne nommée) : commence par une salutation neutre ("Bonjour," ou "Bonjour madame, monsieur,") sans prénom, et n'invente jamais de nom de personne`,
    );
  }

  const userSections: string[] = [
    `Génère un message pour ce prospect.`,
    "",
    `## Entreprise`,
    `${ctx.company.name} · ${ctx.company.industry ?? "secteur non précisé"} · Standing : ${ctx.company.standing ?? "—"}/5`,
    ctx.signal
      ? `Signal actif : ${ctx.signal.type} (détecté il y a ${ctx.signal.ageDays} jour${ctx.signal.ageDays === 1 ? "" : "s"})`
      : `(aucun signal à mentionner)`,
    `Score hitempo : ${ctx.company.score ?? "—"}/100`,
    "",
    `## Contact`,
    ctx.contact.kind === "generic"
      ? `Adresse générique (pas de personne nommée) · ${ctx.contact.jobTitle ?? "—"}`
      : `${formatContactName(ctx.contact)} · ${ctx.contact.jobTitle ?? "—"}`,
    "",
    `## Historique d'interactions (${ctx.interactions.length} ${ctx.interactions.length === 1 ? "dernière" : "dernières"})`,
    ctx.interactions.length === 0
      ? `(aucune interaction loguée)`
      : ctx.interactions
          .map(
            (i) =>
              `- ${formatDate(i.occurredAt)} · ${i.type}/${i.channel}${i.outcome ? "/" + i.outcome : ""} : ${i.summary ?? "(pas de résumé)"}`,
          )
          .join("\n"),
    "",
    `## Messages précédents que nous lui avons envoyés`,
    ctx.previousMessages.length === 0
      ? `(aucun)`
      : ctx.previousMessages
          .map(
            (m) =>
              `--- ${formatDate(m.createdAt)} · ${m.channel}/${m.intent} ---\n${m.content}`,
          )
          .join("\n\n"),
    "",
    `## Intent du message à générer`,
    `${ctx.intent} via ${ctx.channel}`,
  ];

  if (ctx.orientation && ctx.orientation.trim().length > 0) {
    userSections.push("", `## Orientation spécifique demandée`, ctx.orientation.trim());
  }

  userSections.push(
    "",
    `Rédige uniquement le message final, sans préambule ni commentaire.`,
  );
  if (ctx.channel === "email") {
    userSections.push(
      `Format : "Objet: <ton objet>" sur la première ligne, ligne vide, puis le corps.`,
    );
  }

  return {
    systemPrompt: systemSections.join("\n"),
    userPrompt: userSections.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// English templates
// ---------------------------------------------------------------------------

function buildEnglish(ctx: OutboundMessageContext) {
  const brand = ctx.brandBrief;

  const systemSections: string[] = [
    `You are a sales copywriting assistant.`,
    "",
    `Brand positioning: ${brand.positioning}`,
    "",
    `Voice and tone:`,
    `- Tone: ${brand.toneOfVoice.join(", ") || "(not specified)"}`,
    `- Signature expressions to favor: ${formatInline(brand.signatureExpressions)}`,
    `- Words and expressions to avoid at all costs: ${formatInline(brand.forbiddenWords)}`,
    "",
    `Available value propositions:`,
    formatBullets(brand.valueProps),
    "",
    `Proof points you may reference:`,
    formatBullets(brand.proofPoints),
    "",
    `Format constraints for this message:`,
    ctx.channel === "email"
      ? [
          `- Email: 80 to 150 words in the body`,
          `- First line EXACTLY in the format: "Subject: <your subject>"`,
          `- Empty line after the subject`,
          `- Then the body of the message`,
        ].join("\n")
      : `- LinkedIn DM: 300 characters max, no subject, no formal greeting`,
    `- Language: English`,
    `- No price mention`,
    `- Signature: ${ctx.sender.firstName} ${ctx.sender.lastName}`,
    `- Never invent a proof point not in the list above`,
    `- Never repeat a phrase verbatim from a previous message`,
  ];

  if (!ctx.signal) {
    systemSections.push(
      `- Do NOT invent any signal or event (renovation, opening, funding round, etc.) if none is provided in the context below`,
    );
  }

  if (ctx.contact.kind === "generic") {
    systemSections.push(
      `- The contact is a generic address (no named person) : start with a neutral greeting ("Hello," or "Hello,") without a first name, and never invent a person's name`,
    );
  }

  const userSections: string[] = [
    `Generate a message for this prospect.`,
    "",
    `## Company`,
    `${ctx.company.name} · ${ctx.company.industry ?? "industry not specified"} · Standing: ${ctx.company.standing ?? "—"}/5`,
    ctx.signal
      ? `Active signal: ${ctx.signal.type} (detected ${ctx.signal.ageDays} day${ctx.signal.ageDays === 1 ? "" : "s"} ago)`
      : `(no signal to mention)`,
    `hitempo score: ${ctx.company.score ?? "—"}/100`,
    "",
    `## Contact`,
    ctx.contact.kind === "generic"
      ? `Generic address (no named person) · ${ctx.contact.jobTitle ?? "—"}`
      : `${formatContactName(ctx.contact)} · ${ctx.contact.jobTitle ?? "—"}`,
    "",
    `## Interaction history (${ctx.interactions.length} most recent)`,
    ctx.interactions.length === 0
      ? `(no interactions logged yet)`
      : ctx.interactions
          .map(
            (i) =>
              `- ${formatDate(i.occurredAt)} · ${i.type}/${i.channel}${i.outcome ? "/" + i.outcome : ""}: ${i.summary ?? "(no summary)"}`,
          )
          .join("\n"),
    "",
    `## Previous messages we sent`,
    ctx.previousMessages.length === 0
      ? `(none)`
      : ctx.previousMessages
          .map(
            (m) =>
              `--- ${formatDate(m.createdAt)} · ${m.channel}/${m.intent} ---\n${m.content}`,
          )
          .join("\n\n"),
    "",
    `## Intent for the message to generate`,
    `${ctx.intent} via ${ctx.channel}`,
  ];

  if (ctx.orientation && ctx.orientation.trim().length > 0) {
    userSections.push("", `## Specific orientation`, ctx.orientation.trim());
  }

  userSections.push(
    "",
    `Write only the final message, with no preamble or commentary.`,
  );
  if (ctx.channel === "email") {
    userSections.push(
      `Format: "Subject: <your subject>" on the first line, empty line, then the body.`,
    );
  }

  return {
    systemPrompt: systemSections.join("\n"),
    userPrompt: userSections.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Joins the available name parts for a person contact. Generic contacts
 *  are handled by the caller (this is only reached for `kind === 'person'`). */
function formatContactName(contact: { firstName: string | null; lastName: string | null }): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || "—";
}

function formatInline(items: string[]): string {
  if (items.length === 0) return "(aucun)";
  return items.join(", ");
}

function formatBullets(items: string[]): string {
  if (items.length === 0) return "(aucun)";
  return items.map((s) => `- ${s}`).join("\n");
}

/** ISO-like compact date `YYYY-MM-DD`. Stable across locales so snapshots are deterministic. */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

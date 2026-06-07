import { describe, it, expect } from "vitest";
import {
  buildOutboundMessagePrompt,
  type OutboundMessageContext,
} from "@/lib/ai/prompts/outbound-message-prompt";
import { parseChannelIntent } from "@/lib/messages/types";

const SAMPLE_BRIEF = {
  positioning: "Premium plant rental for hospitality",
  toneOfVoice: ["warm", "expert", "concise"],
  forbiddenWords: ["cheap", "discount"],
  signatureExpressions: ["végétal vivant", "expertise paysagère"],
  valueProps: ["No-care contract", "On-site installation in 48h"],
  proofPoints: ["Le Bristol", "Plaza Athénée"],
};

function baseContext(overrides: Partial<OutboundMessageContext> = {}): OutboundMessageContext {
  return {
    brandBrief: SAMPLE_BRIEF,
    company: { name: "Hôtel Westminster", industry: "Hôtellerie", standing: 5, score: 78 },
    signal: null,
    contact: {
      firstName: "Sophie",
      lastName: "Durand",
      jobTitle: "F&B Manager",
      preferredLanguage: "fr",
      relevance: 5,
    },
    interactions: [],
    previousMessages: [],
    sender: { firstName: "Matt", lastName: "Thévenoz" },
    intent: "first_contact",
    channel: "email",
    locale: "fr",
    ...overrides,
  };
}

describe("buildOutboundMessagePrompt — system prompt structure", () => {
  it("includes the brand positioning verbatim", () => {
    const { systemPrompt } = buildOutboundMessagePrompt(baseContext());
    expect(systemPrompt).toContain("Premium plant rental for hospitality");
  });

  it("includes tone, signature expressions, forbidden words, value props, proof points", () => {
    const { systemPrompt } = buildOutboundMessagePrompt(baseContext());
    expect(systemPrompt).toContain("warm, expert, concise");
    expect(systemPrompt).toContain("végétal vivant, expertise paysagère");
    expect(systemPrompt).toContain("cheap, discount");
    expect(systemPrompt).toContain("- No-care contract");
    expect(systemPrompt).toContain("- Le Bristol");
  });

  it("includes the sender's signature instruction", () => {
    const { systemPrompt } = buildOutboundMessagePrompt(baseContext());
    expect(systemPrompt).toContain("Signature : Matt Thévenoz");
  });
});

describe("buildOutboundMessagePrompt — channel format constraints", () => {
  it("for email : requires 'Objet:' format with empty line and body", () => {
    const { systemPrompt } = buildOutboundMessagePrompt(baseContext({ channel: "email" }));
    expect(systemPrompt).toContain('"Objet: <ton objet>"');
    expect(systemPrompt).toContain("80 à 150 mots");
  });

  it("for linkedin : 300 chars max, no subject", () => {
    const { systemPrompt } = buildOutboundMessagePrompt(baseContext({ channel: "linkedin" }));
    expect(systemPrompt).toContain("max 300 caractères");
    expect(systemPrompt).not.toContain('"Objet:');
  });
});

describe("buildOutboundMessagePrompt — signal toggle", () => {
  it("when signal is null : injects 'aucun signal' and anti-invent constraint", () => {
    const { systemPrompt, userPrompt } = buildOutboundMessagePrompt(
      baseContext({ signal: null }),
    );
    expect(userPrompt).toContain("(aucun signal à mentionner)");
    expect(systemPrompt).toContain("Ne PAS inventer de signal");
  });

  it("when signal is provided : mentions it with age, NO anti-invent constraint", () => {
    const { systemPrompt, userPrompt } = buildOutboundMessagePrompt(
      baseContext({
        signal: {
          type: "rénovation",
          detectedAt: new Date("2026-05-15"),
          ageDays: 12,
        },
      }),
    );
    expect(userPrompt).toContain("Signal actif : rénovation");
    expect(userPrompt).toContain("détecté il y a 12 jours");
    expect(systemPrompt).not.toContain("Ne PAS inventer de signal");
  });

  it("handles singular 'jour' when ageDays === 1", () => {
    const { userPrompt } = buildOutboundMessagePrompt(
      baseContext({
        signal: { type: "ouverture", detectedAt: new Date(), ageDays: 1 },
      }),
    );
    expect(userPrompt).toContain("détecté il y a 1 jour)");
  });
});

describe("buildOutboundMessagePrompt — user prompt content", () => {
  it("includes the company name and standing", () => {
    const { userPrompt } = buildOutboundMessagePrompt(baseContext());
    expect(userPrompt).toContain("Hôtel Westminster");
    expect(userPrompt).toContain("Standing : 5/5");
  });

  it("includes the contact full name and job title", () => {
    const { userPrompt } = buildOutboundMessagePrompt(baseContext());
    expect(userPrompt).toContain("Sophie Durand · F&B Manager");
  });

  it("renders '(aucune interaction loguée)' when no interactions", () => {
    const { userPrompt } = buildOutboundMessagePrompt(baseContext());
    expect(userPrompt).toContain("(aucune interaction loguée)");
  });

  it("formats interactions as bullet list with date and outcome", () => {
    const { userPrompt } = buildOutboundMessagePrompt(
      baseContext({
        interactions: [
          {
            occurredAt: new Date("2026-05-14T10:00:00Z"),
            type: "first_contact",
            channel: "email",
            outcome: "no_response",
            summary: "Premier contact L&G",
            interestLevel: null,
          },
        ],
      }),
    );
    expect(userPrompt).toContain("- 2026-05-14 · first_contact/email/no_response : Premier contact L&G");
  });

  it("formats previous messages with separators and full content", () => {
    const { userPrompt } = buildOutboundMessagePrompt(
      baseContext({
        previousMessages: [
          {
            createdAt: new Date("2026-05-20T10:00:00Z"),
            channel: "email",
            intent: "first_contact",
            content: "Bonjour Sophie, blah blah.",
          },
        ],
      }),
    );
    expect(userPrompt).toContain("--- 2026-05-20 · email/first_contact ---");
    expect(userPrompt).toContain("Bonjour Sophie, blah blah.");
  });

  it("appends orientation section when orientation is provided", () => {
    const { userPrompt } = buildOutboundMessagePrompt(
      baseContext({ orientation: "Plus court, mentionne la rénovation" }),
    );
    expect(userPrompt).toContain("## Orientation spécifique demandée");
    expect(userPrompt).toContain("Plus court, mentionne la rénovation");
  });

  it("does NOT add orientation section when omitted or whitespace-only", () => {
    const a = buildOutboundMessagePrompt(baseContext());
    const b = buildOutboundMessagePrompt(baseContext({ orientation: "   " }));
    expect(a.userPrompt).not.toContain("Orientation spécifique");
    expect(b.userPrompt).not.toContain("Orientation spécifique");
  });

  it("contains the 'Rédige uniquement' final instruction for email", () => {
    const { userPrompt } = buildOutboundMessagePrompt(baseContext({ channel: "email" }));
    expect(userPrompt).toContain("Rédige uniquement le message final");
    expect(userPrompt).toContain('"Objet: <ton objet>"');
  });

  it("for LinkedIn : no 'Objet' instruction in user prompt", () => {
    const { userPrompt } = buildOutboundMessagePrompt(baseContext({ channel: "linkedin" }));
    expect(userPrompt).not.toContain("Objet:");
  });
});

describe("buildOutboundMessagePrompt — locale switching", () => {
  it("locale=en produces English prompts", () => {
    const { systemPrompt, userPrompt } = buildOutboundMessagePrompt(
      baseContext({ locale: "en" }),
    );
    expect(systemPrompt).toContain("You are a sales copywriting assistant");
    expect(systemPrompt).toContain('"Subject: <your subject>"');
    expect(userPrompt).toContain("## Company");
    expect(userPrompt).toContain("Generate a message for this prospect");
    expect(userPrompt).not.toMatch(/Génère un message/);
  });

  it("English version mirrors signal toggle behavior", () => {
    const withSignal = buildOutboundMessagePrompt(
      baseContext({
        locale: "en",
        signal: { type: "renovation", detectedAt: new Date(), ageDays: 7 },
      }),
    );
    expect(withSignal.userPrompt).toContain("Active signal: renovation");
    expect(withSignal.userPrompt).toContain("detected 7 days ago");

    const without = buildOutboundMessagePrompt(baseContext({ locale: "en" }));
    expect(without.userPrompt).toContain("(no signal to mention)");
    expect(without.systemPrompt).toContain("Do NOT invent any signal");
  });
});

describe("buildOutboundMessagePrompt — snapshot (one canonical case)", () => {
  it("matches inline snapshot for FR email, first contact, signal ON, with history", () => {
    const ctx = baseContext({
      signal: {
        type: "rénovation",
        detectedAt: new Date("2026-05-15"),
        ageDays: 12,
      },
      interactions: [
        {
          occurredAt: new Date("2026-05-14T09:00:00Z"),
          type: "first_contact",
          channel: "email",
          outcome: "no_response",
          summary: "Premier email présentant L&G",
          interestLevel: null,
        },
      ],
      previousMessages: [
        {
          createdAt: new Date("2026-05-14T09:00:00Z"),
          channel: "email",
          intent: "first_contact",
          content: "Bonjour Sophie, Léon & George rénove...",
        },
      ],
      orientation: "Plus court, ton un peu plus chaleureux",
    });
    const { systemPrompt, userPrompt } = buildOutboundMessagePrompt(ctx);

    expect(systemPrompt).toMatchInlineSnapshot(`
      "Tu es un assistant de rédaction commerciale.

      Positionnement de la marque : Premium plant rental for hospitality

      Voix et ton :
      - Ton : warm, expert, concise
      - Expressions signature à privilégier : végétal vivant, expertise paysagère
      - Mots et expressions à éviter absolument : cheap, discount

      Arguments de valeur disponibles :
      - No-care contract
      - On-site installation in 48h

      Preuves sociales mobilisables :
      - Le Bristol
      - Plaza Athénée

      Contraintes de format pour ce message :
      - Email : 80 à 150 mots dans le corps
      - Première ligne EXACTEMENT au format : "Objet: <ton objet>"
      - Ligne vide après l'objet
      - Puis le corps du message
      - Langue : français
      - Pas de mention de prix
      - Signature : Matt Thévenoz
      - Ne jamais inventer un proof point absent de la liste ci-dessus
      - Ne jamais répéter une phrase mot pour mot d'un message précédent
      - INTERDIT : aucun tiret cadratin "—" (em-dash), aucun tiret demi-cadratin "–" (en-dash). Utiliser virgule, point, deux-points, parenthèses ou point-virgule à la place."
    `);

    expect(userPrompt).toMatchInlineSnapshot(`
      "Génère un message pour ce prospect.

      ## Entreprise
      Hôtel Westminster · Hôtellerie · Standing : 5/5
      Signal actif : rénovation (détecté il y a 12 jours)
      Score hitempo : 78/100

      ## Contact
      Sophie Durand · F&B Manager

      ## Historique d'interactions (1 dernière)
      - 2026-05-14 · first_contact/email/no_response : Premier email présentant L&G

      ## Messages précédents que nous lui avons envoyés
      --- 2026-05-14 · email/first_contact ---
      Bonjour Sophie, Léon & George rénove...

      ## Intent du message à générer
      first_contact via email

      ## Orientation spécifique demandée
      Plus court, ton un peu plus chaleureux

      Rédige uniquement le message final, sans préambule ni commentaire.
      Format : "Objet: <ton objet>" sur la première ligne, ligne vide, puis le corps."
    `);
  });
});

describe("parseChannelIntent", () => {
  it("splits combined value into channel and intent", () => {
    expect(parseChannelIntent("email-first_contact")).toEqual({
      channel: "email",
      intent: "first_contact",
    });
    expect(parseChannelIntent("linkedin-meeting_request")).toEqual({
      channel: "linkedin",
      intent: "meeting_request",
    });
    expect(parseChannelIntent("email-proposal_send")).toEqual({
      channel: "email",
      intent: "proposal_send",
    });
  });
});

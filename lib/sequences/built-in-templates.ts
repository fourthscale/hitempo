import type { DraftDefinition } from "./draft-schema";
import type { LocalizedString } from "./types";

/**
 * Built-in sequence templates (sprint 11). TypeScript objects, NOT a DB table :
 * at sequence creation we CLONE the `draft` into a fresh sequence's
 * `draft_definition` (author step ids remapped to UUIDs on publish).
 *
 * Taxonomy : send_email (AI or defined message), phone_call, wait_delay,
 * conditional_split / _switch, update_contact, enroll_in_sequence. The sequence
 * ends implicitly when a step has no outgoing edge (no explicit end step).
 * All contact-facing copy is LocalizedString FR+EN. Tuned for Léon & George.
 */

export type SequenceTemplate = {
  slug: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  targeting?: {
    targetRelationshipTypes?: string[];
    targetSiteTypes?: string[];
    targetContactRoles?: string[];
  };
  draft: DraftDefinition;
};

const L = (fr: string, en: string): LocalizedString => ({ fr, en });

const wait = (id: string, value: number, unit: "days" | "hours", next: string | null) => ({
  id,
  stepOrder: 0,
  actionType: "wait_delay" as const,
  actionConfig: { durationValue: value, durationUnit: unit },
  nextStepIds: next ? { default: next } : null,
  condition: null,
  filter: null,
});

/** Re-number stepOrder by array position so authors don't track it by hand. */
function ordered(steps: DraftDefinition["steps"]): DraftDefinition["steps"] {
  return steps.map((s, i) => ({ ...s, stepOrder: i }));
}

// ---------------------------------------------------------------------------
// 1. Hôtel Prospect — Premier contact
// ---------------------------------------------------------------------------

const hotelFirstContact: SequenceTemplate = {
  slug: "hotel-first-contact",
  name: { fr: "Hôtel prospect — Premier contact", en: "Hotel prospect — First touch" },
  description: {
    fr: "Approche d'un hôtel parisien : email d'introduction, relance téléphonique, relance email conditionnée.",
    en: "Approaching a Paris hotel: intro email, phone follow-up, conditioned email follow-up.",
  },
  targeting: { targetRelationshipTypes: ["prospect"], targetSiteTypes: ["hotel"] },
  draft: {
    entryStepId: "intro",
    steps: ordered([
      {
        id: "intro",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "ai",
          channel: "email",
          intent: "first_contact",
          titleTemplate: L("Email d'introduction à l'hôtel", "Send intro email to the hotel"),
          orientation: L(
            "Présenter Léon & George, créer un lien avec l'ambiance de l'établissement, proposer un rendez-vous découverte.",
            "Introduce Léon & George, connect to the property's atmosphere, propose a discovery meeting.",
          ),
          includeSignal: true,
        },
        nextStepIds: { default: "wait1" },
        condition: null,
        filter: null,
      },
      wait("wait1", 3, "days", "call"),
      {
        id: "call",
        stepOrder: 0,
        actionType: "phone_call",
        actionConfig: {
          titleTemplate: L("Appeler l'hôtel pour relancer", "Call the hotel to follow up"),
          description: L(
            "Vérifier la bonne réception de l'email, proposer un créneau de visite.",
            "Confirm the email was received, propose a site visit slot.",
          ),
        },
        condition: { type: "if_no_inbound" },
        nextStepIds: { default: "wait2" },
        filter: null,
      },
      wait("wait2", 4, "days", "relance"),
      {
        id: "relance",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "ai",
          channel: "email",
          intent: "follow_up",
          titleTemplate: L("Relance email", "Follow-up email"),
          orientation: L(
            "Relance courte et chaleureuse, apporter une nouvelle accroche (saisonnalité, référence locale).",
            "Short warm follow-up, add a fresh hook (seasonality, local reference).",
          ),
        },
        condition: { type: "if_no_inbound" },
        nextStepIds: null,
        filter: null,
      },
    ]),
  },
};

// ---------------------------------------------------------------------------
// 2. Bureau RH — Approche wellness
// ---------------------------------------------------------------------------

const officeWellness: SequenceTemplate = {
  slug: "office-wellness",
  name: { fr: "Bureau RH — Approche wellness", en: "Office HR — Wellness approach" },
  description: {
    fr: "Approche d'un service RH/office manager sur l'angle bien-être au travail.",
    en: "Approaching an HR / office manager on the workplace wellbeing angle.",
  },
  targeting: { targetRelationshipTypes: ["prospect"], targetSiteTypes: ["office"] },
  draft: {
    entryStepId: "intro",
    steps: ordered([
      {
        id: "intro",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "ai",
          channel: "email",
          intent: "first_contact",
          titleTemplate: L("Email d'introduction RH", "Send HR intro email"),
          orientation: L(
            "Angle bien-être au travail, impact des plantes sur les espaces et la marque employeur.",
            "Workplace-wellbeing angle, the impact of plants on spaces and employer brand.",
          ),
          includeSignal: true,
        },
        nextStepIds: { default: "wait1" },
        condition: null,
        filter: null,
      },
      wait("wait1", 5, "days", "relance"),
      {
        id: "relance",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "ai",
          channel: "email",
          intent: "follow_up",
          titleTemplate: L("Relance email RH", "HR follow-up email"),
          orientation: L(
            "Proposer un diagnostic gratuit des espaces, ton concret et orienté résultat.",
            "Offer a free space assessment, concrete and outcome-oriented tone.",
          ),
        },
        condition: { type: "if_no_inbound" },
        nextStepIds: { default: "wait2" },
        filter: null,
      },
      wait("wait2", 7, "days", "call"),
      {
        id: "call",
        stepOrder: 0,
        actionType: "phone_call",
        actionConfig: {
          titleTemplate: L("Appeler l'office manager", "Call the office manager"),
        },
        condition: { type: "if_no_inbound" },
        nextStepIds: null,
        filter: null,
      },
    ]),
  },
};

// ---------------------------------------------------------------------------
// 3. Agence prescriptrice — Onboarding
// ---------------------------------------------------------------------------

const agencyOnboarding: SequenceTemplate = {
  slug: "agency-onboarding",
  name: { fr: "Agence prescriptrice — Onboarding", en: "Prescriber agency — Onboarding" },
  description: {
    fr: "Onboarding d'une agence d'architecture/décoration partenaire prescriptrice.",
    en: "Onboarding a partner architecture / interior-design prescriber agency.",
  },
  targeting: { targetRelationshipTypes: ["partner", "prospect"], targetContactRoles: ["decision_maker"] },
  draft: {
    entryStepId: "welcome",
    steps: ordered([
      {
        id: "welcome",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "defined",
          channel: "email",
          intent: "first_contact",
          titleTemplate: L("Email de bienvenue partenaire", "Send partner welcome email"),
          subject: L("Bienvenue dans le programme prescripteur Léon & George", "Welcome to the Léon & George prescriber program"),
          body: L(
            "Bonjour,\n\nRavi de vous compter parmi nos partenaires prescripteurs. Vous trouverez en pièce jointe notre plaquette et nos conditions partenaires.\n\nÀ très vite,",
            "Hello,\n\nDelighted to have you as a prescriber partner. Please find attached our brochure and partner terms.\n\nSpeak soon,",
          ),
        },
        nextStepIds: { default: "wait1" },
        condition: null,
        filter: null,
      },
      wait("wait1", 7, "days", "point"),
      {
        id: "point",
        stepOrder: 0,
        actionType: "send_email",
        actionConfig: {
          mode: "ai",
          channel: "email",
          intent: "meeting_request",
          titleTemplate: L("Proposer un point de cadrage", "Propose a kickoff call"),
          orientation: L(
            "Proposer un rendez-vous pour cadrer la collaboration et les premiers projets.",
            "Propose a meeting to frame the partnership and first projects.",
          ),
        },
        condition: { type: "if_no_inbound" },
        nextStepIds: null,
        filter: null,
      },
    ]),
  },
};

export const BUILT_IN_TEMPLATES: SequenceTemplate[] = [
  hotelFirstContact,
  officeWellness,
  agencyOnboarding,
];

export function getBuiltInTemplate(slug: string): SequenceTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.slug === slug);
}

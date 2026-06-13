import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { eq } from "drizzle-orm";
import { getAdminDb } from "./client";
import { companies, contacts, interactions, organizationMembers, organizations, sites, tasks } from "./schema";

/**
 * Demo data for sprint 04 — gives L&G a realistic set of companies/sites/contacts
 * matching the dashboard mockup, and Bristol a single tiny dataset so impersonation
 * shows a different list.
 *
 * Idempotent via name lookups on each insert (won't duplicate on re-run).
 */
async function main() {
  const db = getAdminDb();

  const [lg] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, "leon-george"));
  const [bristol] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, "hotel-le-bristol"));

  if (!lg) {
    console.error("Léon & George org missing — run `npm run db:seed` first.");
    process.exit(1);
  }
  if (!bristol) {
    console.error("Hôtel Le Bristol org missing — run `npm run db:seed-demo` first.");
    process.exit(1);
  }

  // -----------------------------------------------------------------
  // Léon & George — 4 companies, ~5 sites, ~8 contacts
  // -----------------------------------------------------------------

  // Group parent — Warwick Hotels (holds Westminster + future Warwick hotels)
  const [warwick] = await db
    .insert(companies)
    .values({
      organizationId: lg.id,
      name: "Warwick Hotels",
      legalName: "Warwick International Hotels",
      websiteUrl: "https://www.warwickhotels.com",
      relationshipType: "prospect",
      primaryLocale: "en",
      sizeEstimate: "1000+",
      standing: 4,
      industry: "Hospitality (group)",
      status: "to_qualify",
      notes: "Groupe hôtelier international, holding parent de plusieurs hôtels Paris.",
    })
    .returning();
  if (!warwick) throw new Error("Failed to insert Warwick");

  const [westminster] = await db
    .insert(companies)
    .values({
      organizationId: lg.id,
      parentId: warwick.id,
      name: "Hôtel Westminster",
      legalName: "Hôtel Westminster SAS",
      websiteUrl: "https://www.warwickwestminsteropera.com",
      relationshipType: "prospect",
      primaryLocale: "fr",
      sizeEstimate: "51-200",
      standing: 4,
      industry: "Hospitality",
      score: 88,
      status: "to_contact",
      signalType: "renovation",
      signalSource: "BFM Business",
      signalDetectedAt: new Date("2026-04-15"),
      notes: "Rénovation prévue Q3 2026 — opportunité plantes hall + chambres premium.",
    })
    .returning();
  if (!westminster) throw new Error("Failed to insert Westminster");

  // A second Warwick hotel to show group siblings
  await db.insert(companies).values({
    organizationId: lg.id,
    parentId: warwick.id,
    name: "Warwick Champs-Élysées",
    legalName: "Warwick Champs-Élysées SAS",
    websiteUrl: "https://www.warwickchampselysees.com",
    relationshipType: "prospect",
    primaryLocale: "fr",
    sizeEstimate: "51-200",
    standing: 4,
    industry: "Hospitality",
    score: 79,
    status: "to_qualify",
  });

  const [exotrail] = await db
    .insert(companies)
    .values({
      organizationId: lg.id,
      name: "Exotrail",
      legalName: "Exotrail SAS",
      websiteUrl: "https://www.exotrail.com",
      relationshipType: "prospect",
      primaryLocale: "fr",
      sizeEstimate: "51-200",
      standing: 3,
      industry: "Aerospace / Tech",
      score: 82,
      status: "to_follow_up",
      signalType: "fundraising",
      signalSource: "TechCrunch",
      signalDetectedAt: new Date("2026-05-02"),
      notes: "Levée Series B 24M€. Nouveau bureau à Massy. Pas de réponse à l'email 1.",
    })
    .returning();
  if (!exotrail) throw new Error("Failed to insert Exotrail");

  const [studio] = await db
    .insert(companies)
    .values({
      organizationId: lg.id,
      name: "Studio Marc Hertrich & Associés",
      legalName: "Studio Marc Hertrich SARL",
      websiteUrl: "https://www.studiomarchertrich.com",
      relationshipType: "prescriber",
      primaryLocale: "fr",
      sizeEstimate: "11-50",
      standing: 5,
      industry: "Interior architecture",
      score: 86,
      status: "qualified",
      notes: "Architecte d'intérieur, prescripteur prioritaire. Accord pour rappel à 14h30.",
    })
    .returning();
  if (!studio) throw new Error("Failed to insert Studio Marc Hertrich");

  const [wojo] = await db
    .insert(companies)
    .values({
      organizationId: lg.id,
      name: "Wojo Madeleine",
      websiteUrl: "https://www.wojo.com",
      relationshipType: "prospect",
      primaryLocale: "fr",
      sizeEstimate: "11-50",
      standing: 3,
      industry: "Coworking",
      score: 81,
      status: "to_contact",
      signalType: "opening",
      signalSource: "Le Figaro Immobilier",
      signalDetectedAt: new Date("2026-05-10"),
      notes: "Ouverture nouveau site Madeleine prévue septembre.",
    })
    .returning();
  if (!wojo) throw new Error("Failed to insert Wojo");

  // Sites
  const [westminsterSite] = await db
    .insert(sites)
    .values({
      organizationId: lg.id,
      companyId: westminster.id,
      name: "Westminster Paris Opéra",
      type: "hotel",
      addressLine1: "13 Rue de la Paix",
      postalCode: "75002",
      city: "Paris",
      region: "Île-de-France",
      country: "FR",
      isPrimary: true,
      standing: 4,
    })
    .returning();

  const [exotrailHq] = await db
    .insert(sites)
    .values({
      organizationId: lg.id,
      companyId: exotrail.id,
      name: "Exotrail HQ Massy",
      type: "office",
      addressLine1: "13 Rue Galilée",
      postalCode: "91300",
      city: "Massy",
      region: "Île-de-France",
      country: "FR",
      isPrimary: true,
      standing: 3,
    })
    .returning();

  const [studioOffice] = await db
    .insert(sites)
    .values({
      organizationId: lg.id,
      companyId: studio.id,
      name: "Studio Paris 8e",
      type: "office",
      addressLine1: "1 Avenue de Friedland",
      postalCode: "75008",
      city: "Paris",
      region: "Île-de-France",
      country: "FR",
      isPrimary: true,
      standing: 5,
    })
    .returning();

  const [wojoSite] = await db
    .insert(sites)
    .values({
      organizationId: lg.id,
      companyId: wojo.id,
      name: "Wojo Madeleine",
      type: "office",
      addressLine1: "9 Boulevard de la Madeleine",
      postalCode: "75001",
      city: "Paris",
      region: "Île-de-France",
      country: "FR",
      isPrimary: true,
      standing: 3,
    })
    .returning();

  // A secondary site for Exotrail (to test multi-site companies)
  await db.insert(sites).values({
    organizationId: lg.id,
    companyId: exotrail.id,
    name: "Exotrail Toulouse",
    type: "office",
    addressLine1: "10 Avenue de l'Europe",
    postalCode: "31520",
    city: "Ramonville-Saint-Agne",
    region: "Occitanie",
    country: "FR",
    isPrimary: false,
    standing: 3,
  });

  // Contacts
  await db.insert(contacts).values([
    {
      organizationId: lg.id,
      companyId: westminster.id,
      siteId: westminsterSite?.id ?? null,
      firstName: "Sophie",
      lastName: "Durand",
      jobTitle: "Responsable Hébergement",
      role: "decision_maker",
      email: "sophie.durand@example.com",
      preferredLanguage: "fr",
      preferredChannel: "email",
      relevance: 5,
      status: "to_contact",
    },
    {
      organizationId: lg.id,
      companyId: westminster.id,
      siteId: westminsterSite?.id ?? null,
      firstName: "Pierre",
      lastName: "Martin",
      jobTitle: "Directeur Général",
      role: "decision_maker",
      email: "p.martin@example.com",
      preferredLanguage: "fr",
      preferredChannel: "email",
      relevance: 4,
      status: "to_contact",
    },
    {
      organizationId: lg.id,
      companyId: exotrail.id,
      siteId: exotrailHq?.id ?? null,
      firstName: "Alexandre",
      lastName: "Braud",
      jobTitle: "Office Manager",
      role: "decision_maker",
      email: "alexandre.braud@exotrail.com",
      preferredLanguage: "fr",
      preferredChannel: "email",
      relevance: 5,
      status: "to_follow_up",
      lastContactedAt: new Date("2026-05-14"),
    },
    {
      organizationId: lg.id,
      companyId: exotrail.id,
      siteId: exotrailHq?.id ?? null,
      firstName: "Marie",
      lastName: "Lefèvre",
      jobTitle: "Chief People Officer",
      role: "influencer",
      email: "marie.lefevre@exotrail.com",
      preferredLanguage: "fr",
      relevance: 3,
      status: "to_contact",
    },
    {
      organizationId: lg.id,
      companyId: studio.id,
      siteId: studioOffice?.id ?? null,
      firstName: "Christophe",
      lastName: "Daudré",
      jobTitle: "Associé",
      role: "decision_maker",
      email: "c.daudre@studio.com",
      phone: "+33 1 45 62 12 34",
      preferredLanguage: "fr",
      preferredChannel: "phone",
      relevance: 5,
      status: "qualified",
      lastContactedAt: new Date("2026-05-23"),
      lastResponseAt: new Date("2026-05-23"),
    },
    {
      organizationId: lg.id,
      companyId: studio.id,
      siteId: studioOffice?.id ?? null,
      firstName: "Camille",
      lastName: "Rousseau",
      jobTitle: "Chef de Projet",
      role: "user",
      email: "camille@studio.com",
      preferredLanguage: "fr",
      relevance: 3,
      status: "to_contact",
    },
    {
      organizationId: lg.id,
      companyId: wojo.id,
      siteId: wojoSite?.id ?? null,
      firstName: "Julien",
      lastName: "Petit",
      jobTitle: "Site Manager",
      role: "decision_maker",
      email: "julien.petit@wojo.com",
      preferredLanguage: "fr",
      preferredChannel: "email",
      relevance: 4,
      status: "to_contact",
    },
    {
      organizationId: lg.id,
      companyId: wojo.id,
      siteId: wojoSite?.id ?? null,
      firstName: "Léa",
      lastName: "Bernard",
      jobTitle: "Community Manager",
      role: "influencer",
      email: "lea.bernard@wojo.com",
      preferredLanguage: "fr",
      relevance: 3,
      status: "to_contact",
    },
  ]);

  // -----------------------------------------------------------------
  // Hôtel Le Bristol — 1 company, 1 site, 1 contact (impersonation demo)
  // -----------------------------------------------------------------

  const [bristolCompany] = await db
    .insert(companies)
    .values({
      organizationId: bristol.id,
      name: "Plaza Athénée",
      websiteUrl: "https://www.dorchestercollection.com",
      relationshipType: "prospect",
      primaryLocale: "fr",
      sizeEstimate: "201-500",
      standing: 5,
      industry: "Hospitality",
      score: 92,
      status: "to_contact",
      signalType: "renovation",
      notes: "Concurrent direct du Bristol. Rénovation suites royales en cours.",
    })
    .returning();
  if (!bristolCompany) throw new Error("Failed to insert Plaza Athénée");

  const [bristolSite] = await db
    .insert(sites)
    .values({
      organizationId: bristol.id,
      companyId: bristolCompany.id,
      name: "Plaza Athénée Paris",
      type: "hotel",
      addressLine1: "25 Avenue Montaigne",
      postalCode: "75008",
      city: "Paris",
      country: "FR",
      isPrimary: true,
      standing: 5,
    })
    .returning();

  await db.insert(contacts).values({
    organizationId: bristol.id,
    companyId: bristolCompany.id,
    siteId: bristolSite?.id ?? null,
    firstName: "Isabelle",
    lastName: "Moreau",
    jobTitle: "General Manager",
    role: "decision_maker",
    email: "i.moreau@example.com",
    preferredLanguage: "fr",
    preferredChannel: "email",
    relevance: 5,
    status: "to_contact",
  });

  // Fetch back seeded contacts for FK references
  const lgContacts = await db.query.contacts.findMany({
    where: eq(contacts.organizationId, lg.id),
    columns: { id: true, firstName: true, lastName: true, companyId: true },
  });

  const sophieDurand = lgContacts.find((c) => c.firstName === "Sophie" && c.lastName === "Durand");
  const alexandreBraud = lgContacts.find((c) => c.firstName === "Alexandre" && c.lastName === "Braud");
  const christopheDaudre = lgContacts.find((c) => c.firstName === "Christophe" && c.lastName === "Daudré");
  const julienPetit = lgContacts.find((c) => c.firstName === "Julien" && c.lastName === "Petit");

  const lgUser = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.organizationId, lg.id),
    columns: { userId: true },
  });
  const lgUserId = lgUser?.userId ?? "00000000-0000-0000-0000-000000000000";

  // -----------------------------------------------------------------
  // Léon & George — interactions (sprint 05 seed)
  // -----------------------------------------------------------------
  if (sophieDurand && westminster) {
    await db.insert(interactions).values([
      {
        organizationId: lg.id,
        companyId: westminster.id,
        contactId: sophieDurand.id,
        type: "first_contact",
        channel: "email",
        outcome: "no_response",
        summary: "Email de présentation Léon & George. Sujet : plantes pour la rénovation Q3.",
        occurredAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
        userId: lgUserId,
      },
      {
        organizationId: lg.id,
        companyId: westminster.id,
        contactId: sophieDurand.id,
        type: "follow_up",
        channel: "email",
        outcome: "positive_reply",
        summary: "Relance J+7. Sophie répond : intéressée, souhaite un catalogue.",
        occurredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        userId: lgUserId,
      },
    ]);
  }

  if (alexandreBraud && exotrail) {
    await db.insert(interactions).values({
      organizationId: lg.id,
      companyId: exotrail.id,
      contactId: alexandreBraud.id,
      type: "first_contact",
      channel: "email",
      outcome: "no_response",
      summary: "Email premier contact — signal levée Series B 24M€.",
      occurredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      userId: lgUserId,
    });
  }

  if (christopheDaudre && studio) {
    await db.insert(interactions).values({
      organizationId: lg.id,
      companyId: studio.id,
      contactId: christopheDaudre.id,
      type: "call",
      channel: "phone",
      outcome: "rdv_scheduled",
      summary: "Appel de qualification. Prescripteur très intéressé. RDV fixé pour présentation.",
      interestLevel: 5,
      occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      userId: lgUserId,
    });
  }

  if (julienPetit && wojo) {
    await db.insert(interactions).values([
      {
        organizationId: lg.id,
        companyId: wojo.id,
        contactId: julienPetit.id,
        type: "linkedin",
        channel: "linkedin",
        outcome: "positive_reply",
        summary: "Connexion LinkedIn acceptée. A répondu positivement à la demande.",
        occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        userId: lgUserId,
      },
      {
        organizationId: lg.id,
        companyId: wojo.id,
        contactId: julienPetit.id,
        type: "meeting",
        channel: "in_person",
        outcome: "positive_reply",
        summary: "Visite du site Wojo Madeleine. Julien très intéressé pour les espaces communs.",
        interestLevel: 4,
        occurredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        userId: lgUserId,
      },
    ]);
  }

  // -----------------------------------------------------------------
  // Léon & George — tasks (sprint 05 seed)
  // -----------------------------------------------------------------
  const today = new Date();
  today.setHours(10, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const in3Days = new Date(today);
  in3Days.setDate(in3Days.getDate() + 3);
  in3Days.setHours(14, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 2);
  yesterday.setHours(10, 0, 0, 0);

  if (sophieDurand && westminster) {
    await db.insert(tasks).values({
      organizationId: lg.id,
      companyId: westminster.id,
      contactId: sophieDurand.id,
      // Sprint 14 — task_type no longer has a `follow_up` value
      // (intent vs channel — see schema comment). The relance demo
      // becomes a plain email task ; the title carries the intent.
      type: "email",
      title: "Envoyer catalogue tarifaire (relance)",
      description: "Sophie a demandé le catalogue suite à la relance email.",
      status: "pending",
      priority: "high",
      dueAt: new Date(today),
      assigneeId: lgUserId,
    });
  }

  if (alexandreBraud && exotrail) {
    await db.insert(tasks).values({
      organizationId: lg.id,
      companyId: exotrail.id,
      contactId: alexandreBraud.id,
      type: "email",
      title: "Email relance J+12",
      description: "Email 1 sans réponse. Signal levée Series B à mentionner.",
      status: "pending",
      priority: "high",
      dueAt: yesterday,
      assigneeId: lgUserId,
    });
  }

  if (christopheDaudre && studio) {
    await db.insert(tasks).values({
      organizationId: lg.id,
      companyId: studio.id,
      contactId: christopheDaudre.id,
      type: "phone",
      title: "Rappel 14h30 — présentation offre prescripteurs",
      description: "Accord donné lors de l'appel de qualification.",
      status: "pending",
      priority: "urgent",
      dueAt: new Date(today),
      assigneeId: lgUserId,
    });
  }

  if (julienPetit && wojo) {
    await db.insert(tasks).values({
      organizationId: lg.id,
      companyId: wojo.id,
      contactId: julienPetit.id,
      type: "visit",
      title: "Visite site + présentation végétalisation",
      description: "Suite à la réunion positive. Préparer book plantes espaces coworking.",
      status: "pending",
      priority: "medium",
      dueAt: in3Days,
      assigneeId: lgUserId,
    });
  }

  if (westminster) {
    await db.insert(tasks).values({
      organizationId: lg.id,
      companyId: westminster.id,
      contactId: null,
      type: "research",
      title: "Identifier 2ème contact chez Westminster",
      description: "Responsable événementiel en plus de Sophie Durand.",
      status: "pending",
      priority: "low",
      dueAt: tomorrow,
      assigneeId: lgUserId,
    });
  }

  // Bristol — 1 interaction for RLS isolation test
  if (bristolCompany) {
    const bristolContacts = await db.query.contacts.findMany({
      where: eq(contacts.organizationId, bristol.id),
      columns: { id: true },
    });
    const bristolContact = bristolContacts[0];
    await db.insert(interactions).values({
      organizationId: bristol.id,
      companyId: bristolCompany.id,
      contactId: bristolContact?.id ?? null,
      type: "first_contact",
      channel: "email",
      outcome: "no_response",
      occurredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
  }

  console.log("Seeded demo data:");
  console.log("  Léon & George → 4 companies, 5 sites, 8 contacts, 6 interactions, 5 tasks");
  console.log("  Hôtel Le Bristol → 1 company, 1 site, 1 contact, 1 interaction");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

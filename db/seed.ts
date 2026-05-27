import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { getAdminDb } from "./client";
import { organizations } from "./schema";

async function seed() {
  const adminDb = getAdminDb();

  const [lg] = await adminDb.insert(organizations).values({
    slug: "leon-george",
    name: "Léon & George",
    plan: "trial",
    defaultLocale: "fr",
    supportedLocales: ["fr", "en"],
    // Brand brief is now structured (BrandBrief type — see lib/brand/brand-brief.ts).
    // The real L&G brand brief is applied via lib/brand/seed-leon-george.ts in sprint 07.
    brandBrief: {},
    settings: {},
  }).returning();

  console.log("Seeded org:", lg);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

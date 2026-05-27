import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { getAdminDb } from "./client";
import { organizations } from "./schema";

async function main() {
  const db = getAdminDb();
  const [bristol] = await db
    .insert(organizations)
    .values({
      slug: "hotel-le-bristol",
      name: "Hôtel Le Bristol",
      plan: "trial",
      defaultLocale: "fr",
      supportedLocales: ["fr", "en"],
      // Bristol is a demo org for impersonation testing — no brand brief seeded.
      brandBrief: {},
      settings: {},
    })
    .onConflictDoNothing({ target: organizations.slug })
    .returning();

  console.log(
    bristol ? `Seeded ${bristol.name} (${bristol.id})` : "Hôtel Le Bristol already exists",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

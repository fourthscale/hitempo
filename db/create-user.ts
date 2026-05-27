import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { getAdminDb } from "./client";
import { organizationMembers, organizations } from "./schema";

type Role = "owner" | "admin" | "commercial" | "viewer";

const VALID_ROLES: ReadonlySet<Role> = new Set(["owner", "admin", "commercial", "viewer"]);

async function main() {
  const [email, password, orgSlug, roleArg = "commercial"] = process.argv.slice(2);

  if (!email || !password || !orgSlug) {
    console.error("Usage: tsx db/create-user.ts <email> <password> <org-slug> [role]");
    console.error("       role defaults to 'commercial'. Valid: owner | admin | commercial | viewer");
    process.exit(1);
  }
  if (!VALID_ROLES.has(roleArg as Role)) {
    console.error(`Invalid role "${roleArg}". Valid: owner | admin | commercial | viewer`);
    process.exit(1);
  }
  const role = roleArg as Role;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const db = getAdminDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });
  if (!org) {
    console.error(`No organization with slug "${orgSlug}". Run "npm run db:seed" first.`);
    process.exit(1);
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error("createUser failed:", error?.message ?? "unknown");
    process.exit(1);
  }

  const userId = data.user.id;

  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId,
    role,
    preferredLocale: "fr",
    timezone: "Europe/Paris",
  });

  console.log(`Created ${email} (${userId}) as ${role} of "${org.name}" (${org.slug})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

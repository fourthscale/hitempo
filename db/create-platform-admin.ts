import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { getAdminDb } from "./client";
import { platformAdmins } from "./schema";

/**
 * Create a NEW auth user as a PURE platform admin — no organization membership.
 * They land on /admin/orgs after login and pick an org to inspect.
 *
 * Usage: tsx db/create-platform-admin.ts <email> <password> [note]
 */
async function main() {
  const [email, password, note] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage: tsx db/create-platform-admin.ts <email> <password> [note]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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

  const db = getAdminDb();
  await db
    .insert(platformAdmins)
    .values({ userId, note: note ?? null })
    .onConflictDoNothing();

  console.log(
    `Created ${email} (${userId}) as PLATFORM ADMIN with no org membership.`,
  );
  console.log(`On login they land on /admin/orgs.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

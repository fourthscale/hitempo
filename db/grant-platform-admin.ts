import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { getAdminDb } from "./client";
import { platformAdmins } from "./schema";

async function findUserIdByEmail(supabaseUrl: string, serviceRole: string, email: string) {
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 100) break;
  }
  return null;
}

async function main() {
  const [email, note] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: tsx db/grant-platform-admin.ts <email> [note]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const userId = await findUserIdByEmail(supabaseUrl, serviceRole, email);
  if (!userId) {
    console.error(`No auth user with email "${email}"`);
    process.exit(1);
  }

  const db = getAdminDb();
  await db
    .insert(platformAdmins)
    .values({ userId, note: note ?? null })
    .onConflictDoNothing();

  console.log(`${email} (${userId}) is now a platform admin.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

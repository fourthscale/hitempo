import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { getAdminDb } from "./client";
import { organizationMembers } from "./schema";

async function main() {
  const [email] = process.argv.slice(2);

  if (!email) {
    console.error("Usage: tsx db/delete-user.ts <email>");
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
  const db = getAdminDb();

  // Find the auth user. listUsers is paginated; for local/dev volumes we can
  // afford to walk a few pages. In prod we'd lift to a direct SQL lookup.
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      console.error("listUsers failed:", error.message);
      process.exit(1);
    }
    const found = data.users.find((u) => u.email === email);
    if (found) userId = found.id;
    if (data.users.length < 100) break;
  }

  if (!userId) {
    console.error(`No auth user with email "${email}"`);
    process.exit(1);
  }

  // Delete memberships first (no FK to auth.users in our schema → no cascade).
  const deleted = await db
    .delete(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .returning({ id: organizationMembers.id });

  // Delete the auth user.
  const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error("deleteUser failed:", delErr.message);
    process.exit(1);
  }

  console.log(
    `Deleted ${email} (${userId}); removed ${deleted.length} organization membership(s).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

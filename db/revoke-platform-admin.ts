import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { getAdminDb } from "./client";
import { platformAdmins } from "./schema";

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: tsx db/revoke-platform-admin.ts <email>");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error("Missing env vars");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    const found = data.users.find((u) => u.email === email);
    if (found) userId = found.id;
    if (data.users.length < 100) break;
  }
  if (!userId) {
    console.error(`No auth user with email "${email}"`);
    process.exit(1);
  }

  const db = getAdminDb();
  const deleted = await db
    .delete(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .returning({ userId: platformAdmins.userId });

  if (deleted.length === 0) {
    console.log(`${email} was not a platform admin (nothing to revoke).`);
  } else {
    console.log(`${email} (${userId}) is no longer a platform admin.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

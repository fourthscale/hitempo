import { readdirSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const drizzleOut = resolve(__dirname, ".drizzle-out");
const supabaseMigrations = resolve(__dirname, "..", "supabase", "migrations");

if (!existsSync(drizzleOut)) {
  console.error("No drizzle output. Run `npm run db:generate` first.");
  process.exit(1);
}
mkdirSync(supabaseMigrations, { recursive: true });

const existing = new Set(readdirSync(supabaseMigrations));
const drizzleFiles = readdirSync(drizzleOut).filter((f) => f.endsWith(".sql"));

let copied = 0;
for (const file of drizzleFiles) {
  const drizzleName = file.replace(/^\d+_/, "");
  const alreadyCopied = [...existing].some((e) => e.endsWith(`_${drizzleName}`));
  if (alreadyCopied) continue;

  const ts = new Date().toISOString().replace(/[-T:Z.]/g, "").slice(0, 14);
  const targetName = `${ts}_${drizzleName}`;
  const sql = readFileSync(join(drizzleOut, file), "utf8");
  copyFileSync(join(drizzleOut, file), join(supabaseMigrations, targetName));
  console.log(`copied -> supabase/migrations/${targetName} (${sql.length} bytes)`);
  copied++;
}

if (!copied) console.log("nothing to sync");

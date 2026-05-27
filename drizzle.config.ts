import type { Config } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

export default {
  schema: "./db/schema.ts",
  out: "./db/.drizzle-out",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SUPABASE_POSTGRES_DIRECT_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;

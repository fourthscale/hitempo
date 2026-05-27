import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;
export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.SUPABASE_POSTGRES_URL;
  if (!url) {
    throw new Error("SUPABASE_POSTGRES_URL is required");
  }
  const client = postgres(url, { prepare: false });
  _db = drizzle(client, { schema });
  return _db;
}

// Admin client (RLS bypassed) — server-only, never imported from client code.
let _adminDb: Db | null = null;
export function getAdminDb(): Db {
  if (_adminDb) return _adminDb;
  const url = process.env.SUPABASE_POSTGRES_DIRECT_URL;
  if (!url) {
    throw new Error("SUPABASE_POSTGRES_DIRECT_URL is required");
  }
  const adminClient = postgres(url, { prepare: false });
  _adminDb = drizzle(adminClient, { schema });
  return _adminDb;
}

// Convenience proxy: lazy-resolved on first use. Server-only.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    return (getDb() as unknown as Record<PropertyKey, unknown>)[prop];
  },
}) as Db;

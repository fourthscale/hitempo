/**
 * Backwards-compatible facade over `lib/db/db-client.ts`.
 *
 * The class layer (`DbClient` + `DbClientFactory`) is the real implementation ;
 * this module keeps the historical named exports (`getDb`, `getAdminDb`, `db`)
 * so the ~100 existing call sites don't need to change.
 *
 * New code can also import directly from `@/lib/db/db-client-factory`.
 */

import { DbClientFactory } from "@/lib/db/db-client-factory";
import type { Db } from "@/lib/db/db-client";

export type { Db };

/** RLS-bound pool. The pool 95% of queries should use. */
export function getDb(): Db {
  return DbClientFactory.getInstance().getRls();
}

/**
 * Service-role pool (RLS bypassed). Server-only, never reachable from
 * client code. Reserved for trusted jobs (Inngest workers, migrations,
 * narrowly-scoped admin actions).
 */
export function getAdminDb(): Db {
  return DbClientFactory.getInstance().getAdmin();
}

/**
 * Lazy proxy : resolves the RLS pool on first property access. Convenient
 * for top-level imports where the pool isn't needed at module-init time.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    return (getDb() as unknown as Record<PropertyKey, unknown>)[prop];
  },
}) as Db;

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

import { DbMissingUrlError } from "./db-errors";

/** The concrete Drizzle handle exposed to callers. */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Centralized database access — encapsulates the two postgres pools the app
 * needs (RLS-bound for user-facing queries, service-role for trusted jobs)
 * and resolves each one lazily on first use.
 *
 * Lifecycle :
 *   - `getRls()`   opens (and caches) the RLS-bound pool from `rlsUrlVar`
 *   - `getAdmin()` opens (and caches) the service-role pool from `adminUrlVar`
 *
 * Missing URL env vars surface as `DbMissingUrlError` rather than a generic
 * `Error("X is required")`, so callers / Sentry can branch on `error.code`.
 *
 * Tests should construct a `DbClient` against pre-set env vars and call
 * `dispose()` between cases to drop the cached pools.
 */
export class DbClient {
  private rls: Db | null = null;
  private admin: Db | null = null;

  constructor(
    private readonly rlsUrlVar: string,
    private readonly adminUrlVar: string,
  ) {}

  /**
   * Pool whose connection URL targets the connection-pooler with RLS enabled.
   * This is the pool that 95% of queries in user-facing code should use.
   */
  public getRls(): Db {
    if (this.rls) return this.rls;
    this.rls = openPool(this.rlsUrlVar);
    return this.rls;
  }

  /**
   * Pool whose connection URL has service-role access (RLS bypassed). Only
   * trusted server-side jobs should use this — Inngest workers, admin
   * actions explicitly scoped, migrations. Never reachable from client code.
   */
  public getAdmin(): Db {
    if (this.admin) return this.admin;
    this.admin = openPool(this.adminUrlVar);
    return this.admin;
  }

  /**
   * Drops the cached handles so the next call rebuilds them. Useful in tests
   * (rebuild against a different URL between cases). In production the
   * factory keeps a single instance for the lifetime of the process.
   */
  public dispose(): void {
    this.rls = null;
    this.admin = null;
  }
}

function openPool(envVar: string): Db {
  const url = process.env[envVar];
  if (!url) {
    throw new DbMissingUrlError(envVar);
  }
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

import { DbMissingUrlError } from "./db-errors";

/** The concrete Drizzle handle exposed to callers. */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** Internal pair so dispose() can `.end()` the underlying postgres pool. */
type Pool = { db: Db; raw: ReturnType<typeof postgres> };

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
  private rls: Pool | null = null;
  private admin: Pool | null = null;

  constructor(
    private readonly rlsUrlVar: string,
    private readonly adminUrlVar: string,
  ) {}

  /**
   * Pool whose connection URL targets the connection-pooler with RLS enabled.
   * This is the pool that 95% of queries in user-facing code should use.
   */
  public getRls(): Db {
    if (this.rls) return this.rls.db;
    this.rls = openPool(this.rlsUrlVar);
    return this.rls.db;
  }

  /**
   * Pool whose connection URL has service-role access (RLS bypassed). Only
   * trusted server-side jobs should use this — Inngest workers, admin
   * actions explicitly scoped, migrations. Never reachable from client code.
   */
  public getAdmin(): Db {
    if (this.admin) return this.admin.db;
    this.admin = openPool(this.adminUrlVar);
    return this.admin.db;
  }

  /**
   * Closes the underlying postgres connection pools and drops the cached
   * handles. Tests should call this in `afterEach` to avoid saturating the
   * local postgres connection slots. In production it's only invoked by
   * `DbClientFactory.reset()` (also test-only) — the long-lived process
   * keeps a single live pair of pools.
   */
  public async dispose(): Promise<void> {
    const closing: Promise<void>[] = [];
    if (this.rls) closing.push(this.rls.raw.end());
    if (this.admin) closing.push(this.admin.raw.end());
    this.rls = null;
    this.admin = null;
    await Promise.all(closing);
  }
}

function openPool(envVar: string): Pool {
  const url = process.env[envVar];
  if (!url) {
    throw new DbMissingUrlError(envVar);
  }
  const raw = postgres(url, { prepare: false });
  return { db: drizzle(raw, { schema }), raw };
}

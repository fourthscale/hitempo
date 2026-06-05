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
   *
   * Connection-count tuning : `SUPABASE_POSTGRES_POOL_MAX_RLS` caps the per-
   * instance connections (default postgres-js value = 10). Lower it when
   * stuck on Supabase's session pooler free tier (15-slot global cap),
   * higher when on transaction pooler / Pro plan.
   */
  public getRls(): Db {
    if (this.rls) return this.rls.db;
    this.rls = openPool(this.rlsUrlVar, "SUPABASE_POSTGRES_POOL_MAX_RLS", DEFAULT_POOL_MAX_RLS);
    return this.rls.db;
  }

  /**
   * Pool whose connection URL has service-role access (RLS bypassed). Only
   * trusted server-side jobs should use this — Inngest workers, admin
   * actions explicitly scoped, migrations. Never reachable from client code.
   *
   * Connection-count tuning : `SUPABASE_POSTGRES_POOL_MAX_ADMIN` caps this
   * pool independently (default postgres-js value = 10). Worker jobs run
   * mostly sequential queries so a small value (2-3) is usually enough.
   */
  public getAdmin(): Db {
    if (this.admin) return this.admin.db;
    this.admin = openPool(this.adminUrlVar, "SUPABASE_POSTGRES_POOL_MAX_ADMIN", DEFAULT_POOL_MAX_ADMIN);
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

// Defaults sized for Supabase's session pooler on the free tier (15-slot
// global cap, no IPv4 transaction pooler). Override per env var when on a
// Pro / IPv4 setup with a generous pool.
const DEFAULT_POOL_MAX_RLS = 3;
const DEFAULT_POOL_MAX_ADMIN = 2;
const DEFAULT_POOL_IDLE_TIMEOUT_SEC = 20;

function openPool(envVar: string, maxEnvVar: string, defaultMax: number): Pool {
  const url = process.env[envVar];
  if (!url) {
    throw new DbMissingUrlError(envVar);
  }
  const raw = postgres(url, {
    prepare: false,
    max: readPositiveInt(maxEnvVar, defaultMax),
    idle_timeout: readPositiveInt(
      "SUPABASE_POSTGRES_POOL_IDLE_TIMEOUT_SEC",
      DEFAULT_POOL_IDLE_TIMEOUT_SEC,
    ),
  });
  return { db: drizzle(raw, { schema }), raw };
}

/** Parse a positive integer env var, falling back to `defaultValue` when the
 *  var is unset / empty / non-numeric. Keeps a typo in env config from
 *  breaking the pool — it just behaves like default. */
function readPositiveInt(envVar: string, defaultValue: number): number {
  const raw = process.env[envVar];
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return n;
}

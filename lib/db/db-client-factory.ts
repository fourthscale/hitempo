import { DbClient } from "./db-client";

/**
 * Lazy singleton factory for the application's `DbClient`.
 *
 * The two env vars below are the canonical Supabase pool URLs :
 *
 *   - `SUPABASE_POSTGRES_URL`        — transaction-pooled, RLS-enforced
 *   - `SUPABASE_POSTGRES_DIRECT_URL` — session-pooled, service-role (RLS off)
 *
 * Server code should never `new DbClient(...)` directly — it goes through
 * `getInstance()` so the whole process shares one cached pair of pools.
 * Tests can call `setInstance()` / `reset()` to swap a custom client.
 */
export class DbClientFactory {
  private static cached: DbClient | null = null;

  public static getInstance(): DbClient {
    if (this.cached) return this.cached;
    this.cached = new DbClient(
      "SUPABASE_POSTGRES_URL",
      "SUPABASE_POSTGRES_DIRECT_URL",
    );
    return this.cached;
  }

  public static setInstance(client: DbClient): void {
    this.cached = client;
  }

  /**
   * Disposes the cached client (closes the pools) and clears the slot.
   * Returns a promise so tests can `await` the pool teardown ; production
   * code never calls this so the async signature is non-disruptive.
   */
  public static async reset(): Promise<void> {
    const old = this.cached;
    this.cached = null;
    if (old) await old.dispose();
  }
}

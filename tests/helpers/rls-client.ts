import postgres from "postgres";

/**
 * Open a postgres connection that mimics the Supabase REST runtime:
 *   - role set to `authenticated`
 *   - request.jwt.claims set to a fake JWT for the given user_id
 * RLS policies that depend on `auth.uid()` will see this user.
 *
 * Returns a `query` function that runs SQL inside a transaction with the
 * settings applied, plus an `end()` to close the underlying connection.
 *
 * Use the DIRECT connection string, not the pooled one, so SET LOCAL works
 * predictably (transaction-level settings need a stable session).
 */
export function openRlsClient(userId: string | null) {
  const url = process.env.SUPABASE_POSTGRES_DIRECT_URL!;
  const sql = postgres(url, { prepare: false, max: 1 });

  async function query<T extends Record<string, unknown>>(
    sqlText: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE authenticated`);
      const claims = userId
        ? JSON.stringify({ sub: userId, role: "authenticated" })
        : JSON.stringify({ role: "anon" });
      await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}'`);
      return tx.unsafe(sqlText, params);
    }) as unknown as T[];
  }

  async function end() {
    await sql.end({ timeout: 2 });
  }

  return { query, end };
}

/**
 * Service-role client — RLS bypassed. Use to set up fixtures and to grant
 * platform-admin status during tests.
 */
export function openServiceClient() {
  const url = process.env.SUPABASE_POSTGRES_DIRECT_URL!;
  const sql = postgres(url, { prepare: false, max: 1 });
  return {
    sql,
    end: () => sql.end({ timeout: 2 }),
  };
}

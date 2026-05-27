import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { DbClient } from "@/lib/db/db-client";
import { DbClientFactory } from "@/lib/db/db-client-factory";
import { DbMissingUrlError } from "@/lib/db/db-errors";

// `tests/setup.ts` enforces that NEXT_PUBLIC_SUPABASE_URL points to 127.0.0.1
// and loads .env.local, so SUPABASE_POSTGRES_URL is populated. We use that
// local URL to verify the success paths without making any real query.

const RLS_VAR = "SUPABASE_POSTGRES_URL";
const ADMIN_VAR = "SUPABASE_POSTGRES_DIRECT_URL";

// Track every client we instantiate so afterEach can release the underlying
// postgres pool — otherwise the local Supabase saturates its connection
// slots and the unrelated RLS tests start failing.
const opened: DbClient[] = [];

function track(c: DbClient): DbClient {
  opened.push(c);
  return c;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.dispose()));
});

describe("DbClient", () => {
  it("opens the RLS pool only on first getRls() call (lazy)", () => {
    const client = track(new DbClient(RLS_VAR, ADMIN_VAR));
    const rls = client.getRls();
    expect(rls).toBeDefined();
    // Second call returns the same cached handle.
    expect(client.getRls()).toBe(rls);
  });

  it("opens the admin pool only on first getAdmin() call (lazy)", () => {
    const client = track(new DbClient(RLS_VAR, ADMIN_VAR));
    const admin = client.getAdmin();
    expect(admin).toBeDefined();
    expect(client.getAdmin()).toBe(admin);
  });

  it("getRls() and getAdmin() return distinct handles", () => {
    const client = track(new DbClient(RLS_VAR, ADMIN_VAR));
    expect(client.getRls()).not.toBe(client.getAdmin());
  });

  it("throws DbMissingUrlError when the RLS env var is empty", () => {
    const client = track(new DbClient("__UNSET_VAR_FOR_RLS__", ADMIN_VAR));
    let caught: unknown;
    try {
      client.getRls();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DbMissingUrlError);
    expect((caught as DbMissingUrlError).code).toBe("DB_MISSING_URL");
    expect((caught as DbMissingUrlError).envVar).toBe("__UNSET_VAR_FOR_RLS__");
  });

  it("throws DbMissingUrlError when the admin env var is empty", () => {
    const client = track(new DbClient(RLS_VAR, "__UNSET_VAR_FOR_ADMIN__"));
    expect(() => client.getAdmin()).toThrow(DbMissingUrlError);
  });

  it("dispose() drops the cached pools so the next call rebuilds them", async () => {
    const client = new DbClient(RLS_VAR, ADMIN_VAR);
    const first = client.getRls();
    await client.dispose();
    const second = client.getRls();
    expect(second).not.toBe(first);
    await client.dispose();
  });
});

describe("DbClientFactory", () => {
  beforeEach(async () => {
    await DbClientFactory.reset();
  });
  afterEach(async () => {
    await DbClientFactory.reset();
  });

  it("returns the same DbClient instance across calls", () => {
    const a = DbClientFactory.getInstance();
    const b = DbClientFactory.getInstance();
    expect(a).toBe(b);
  });

  it("setInstance() overrides the cached client", () => {
    const custom = track(new DbClient(RLS_VAR, ADMIN_VAR));
    DbClientFactory.setInstance(custom);
    expect(DbClientFactory.getInstance()).toBe(custom);
  });

  it("reset() forces the next getInstance() to rebuild", async () => {
    const a = DbClientFactory.getInstance();
    await DbClientFactory.reset();
    const b = DbClientFactory.getInstance();
    expect(b).not.toBe(a);
  });
});

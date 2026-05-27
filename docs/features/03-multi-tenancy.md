# Sprint 03 — Multi-tenancy & RLS

Lock down the data layer before we start building CRUD. Add the `platform_admins` table (already designed in `architecture.md`), wire the `is_platform_admin()` helper into every existing policy, install an append-only audit log for cross-org writes, and prove the guarantees with executable tests. By the end of this sprint, a normal user from org A literally cannot read or write org B's rows even when bypassing the application filters; a platform admin can read across all orgs but cannot write cross-org unless the policy explicitly allows it.

## Why now

We're about to ship CRUD (sprint 04) and the AI generation (sprint 07). Both will create many policies on many tables. Doing it ad-hoc per sprint produces inconsistent guards and a security review nightmare later. Sprint 03 sets the convention — read pattern, write pattern, audit trigger, helper function — and the next sprints just apply it.

## Guarantees this sprint establishes

By acceptance of this sprint, the following must hold even when an attacker has a valid `anon` JWT (i.e. a real authenticated user trying to escalate):

1. **Tenant isolation on reads**: a user with membership in org A receives **zero rows** when querying any business table for org B's data.
2. **Tenant isolation on writes**: a user with membership in org A cannot `INSERT`, `UPDATE`, or `DELETE` rows scoped to org B.
3. **Platform admin read escape hatch**: a user listed in `platform_admins` reads across **all** orgs.
4. **Platform admin write default-deny**: a platform admin who is not a member of org B cannot `INSERT/UPDATE/DELETE` org B's rows on any table that hasn't explicitly opened cross-org writes via `OR is_platform_admin()` on its write policy. Sprint 03 does not open any such table — it's a per-feature decision in later sprints.
5. **Auditability**: every `INSERT/UPDATE/DELETE` issued by a platform admin against a row outside their own orgs lands in `platform_admin_audit`. (`SELECT` reads aren't trigger-able in Postgres — we log read-time elevation in app code instead, see step 7.)

## Goals

1. New tables: `platform_admins` and `platform_admin_audit`, both with RLS enabled.
2. New SQL helper: `is_platform_admin()` — `STABLE SECURITY DEFINER`, mirrors the shape of `user_organization_ids()`.
3. Updated policies on `organizations` and `organization_members` to combine tenant scope with the platform-admin escape hatch.
4. Generic audit trigger function `log_platform_admin_write()` plus per-table triggers on `organizations` and `organization_members`. Sprint 04+ will attach the same trigger to every new business table via the policy convention.
5. App layer: `getCurrentContext()` (extends `getCurrentOrg`) returns `{ user, membership, organization, isPlatformAdmin }`. A visible "platform admin" pill in the sidebar when the flag is true.
6. Bootstrap: Ludovic is added to `platform_admins` via a one-off seed script (`db/grant-platform-admin.ts`) so we have a real admin user to test the elevated path.
7. Read-time audit (in `lib/auth/context.ts`): when a platform admin enters an org page that is **not** one of their memberships, log a row to `platform_admin_audit` with `operation = 'SELECT'`. Best-effort, server-only.
8. Tests: a real Postgres-backed integration suite (Vitest + the local Supabase stack) that exercises all five guarantees above. This sprint also lands the Vitest setup the project needed eventually anyway.
9. Documentation: short `docs/conventions/rls.md` cheatsheet that every future sprint follows verbatim.

## Prerequisites

- Sprint 02 + 02.5 complete; Ludovic logged in locally
- Local Supabase stack running (`supabase status` shows the API URL)
- L&G seeded, Ludovic in `organization_members` as `owner` of L&G

## What this sprint deliberately does NOT do

- New business tables (companies, sites, contacts) — those are sprint 04. Sprint 03 only adds the security primitives.
- A real platform admin UI on a separate subdomain — V1+.
- A 2FA requirement for platform admins — V1+.
- SELECT auditing at the DB level (Postgres doesn't support SELECT triggers). We do best-effort app-side logging only.
- Audit log retention/archival policy — V1+.

## Implementation plan

### Step 1 — Drizzle schema additions

Add to `db/schema.ts`:

```typescript
import { boolean, foreignKey, primaryKey } from "drizzle-orm/pg-core";

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey(), // FK to auth.users — added as raw SQL after generate
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid("granted_by"),
  note: text("note"),
});

export const platformAdminAudit = pgTable("platform_admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tableName: text("table_name").notNull(),
  rowId: uuid("row_id"),
  operation: text("operation").notNull(), // 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  organizationId: uuid("organization_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index("idx_platform_audit_user").on(t.userId, t.occurredAt),
  byOrg: index("idx_platform_audit_org").on(t.organizationId, t.occurredAt),
  byTable: index("idx_platform_audit_table").on(t.tableName, t.occurredAt),
}));
```

We don't model FK to `auth.users(id)` in Drizzle because that table lives in the `auth` schema (Supabase-managed). We'll add the FK constraint by hand in the migration SQL (it remains valid; Drizzle just won't track it).

### Step 2 — Generate migration

```bash
npm run db:generate -- --name platform_admins
```

Inspect `db/.drizzle-out/0001_platform_admins.sql`. Append the SQL chunks from steps 3 → 6 to that file before syncing.

### Step 3 — `is_platform_admin()` helper

Append:

```sql
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
$$;
```

### Step 4 — Update existing policies + new policies

Drop and recreate the sprint-01 read policies on `organizations` and `organization_members` to include the platform-admin escape hatch. Add explicit write policies that **do not** open the platform-admin path (default-deny on cross-org writes).

```sql
-- organizations
DROP POLICY IF EXISTS "users_read_own_orgs" ON organizations;
CREATE POLICY "read_organizations" ON organizations FOR SELECT USING (
  id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);
CREATE POLICY "write_organizations" ON organizations FOR ALL USING (
  id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  id IN (SELECT public.user_organization_ids())
);

-- organization_members
DROP POLICY IF EXISTS "users_read_own_memberships" ON organization_members;
CREATE POLICY "read_organization_members" ON organization_members FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);
CREATE POLICY "write_organization_members" ON organization_members FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);

-- platform_admins itself
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_manage_admins" ON platform_admins FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- platform_admin_audit
ALTER TABLE platform_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_audit" ON platform_admin_audit FOR SELECT
  USING (public.is_platform_admin());
-- No INSERT/UPDATE/DELETE policy: rows arrive only via the trigger below
-- which runs as the table owner and is therefore not subject to RLS.

-- FK to auth.users (Drizzle doesn't track cross-schema FKs)
ALTER TABLE platform_admins
  ADD CONSTRAINT platform_admins_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
```

### Step 5 — Audit trigger for cross-org writes

```sql
CREATE OR REPLACE FUNCTION public.log_platform_admin_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org_id uuid;
  v_row_id uuid;
BEGIN
  -- Only log when the actor is a platform admin AND the row is outside their orgs.
  IF NOT public.is_platform_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Resolve the row's organization_id and id, depending on op.
  IF TG_OP = 'DELETE' THEN
    v_row_id := (to_jsonb(OLD) ->> 'id')::uuid;
    v_org_id := COALESCE((to_jsonb(OLD) ->> 'organization_id')::uuid, v_row_id); -- self for organizations
  ELSE
    v_row_id := (to_jsonb(NEW) ->> 'id')::uuid;
    v_org_id := COALESCE((to_jsonb(NEW) ->> 'organization_id')::uuid, v_row_id);
  END IF;

  -- If this org is in the admin's own memberships, no cross-org access happened.
  IF v_org_id IN (SELECT public.user_organization_ids()) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO platform_admin_audit (user_id, table_name, row_id, operation, organization_id)
  VALUES (v_user, TG_TABLE_NAME, v_row_id, TG_OP, v_org_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_organizations_admin_audit
  AFTER INSERT OR UPDATE OR DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();

CREATE TRIGGER trg_organization_members_admin_audit
  AFTER INSERT OR UPDATE OR DELETE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();
```

Note: the trigger silently returns the row unchanged when the actor isn't a platform admin, so it adds ~microseconds to writes by regular users. Acceptable.

### Step 6 — Sync + reset + verify

```bash
npm run db:sync
npm run db:reset
npm run db:seed
npm run db:create-user -- ludovic@leonandgeorge.com "TempPass123!" leon-george owner
```

In Studio (`http://127.0.0.1:54323`), verify:
- `platform_admins` and `platform_admin_audit` tables exist
- RLS is enabled on both
- `is_platform_admin()` function exists in `public`
- Triggers `trg_organizations_admin_audit` and `trg_organization_members_admin_audit` exist

### Step 7 — Bootstrap script: grant platform admin

`db/grant-platform-admin.ts`:

```typescript
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { getAdminDb } from "./client";
import { platformAdmins } from "./schema";

async function main() {
  const [email, note] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: tsx db/grant-platform-admin.ts <email> [note]");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // listUsers walks pages; fine for dev volumes.
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    const found = data.users.find((u) => u.email === email);
    if (found) userId = found.id;
    if (data.users.length < 100) break;
  }
  if (!userId) {
    console.error(`No auth user with email "${email}"`);
    process.exit(1);
  }

  const db = getAdminDb();
  await db.insert(platformAdmins).values({ userId, note: note ?? null }).onConflictDoNothing();

  console.log(`${email} (${userId}) is now a platform admin.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"db:grant-platform-admin": "tsx db/grant-platform-admin.ts"
```

Grant Ludovic:

```bash
npm run db:grant-platform-admin -- ludovic@leonandgeorge.com "Founder — bootstrap"
```

A symmetric `db/revoke-platform-admin.ts` lands at the same time for hygiene.

### Step 8 — App helpers + UI affordance

Extend `lib/auth/context.ts`:

```typescript
export async function getCurrentContext() {
  const { user, membership, organization } = await getCurrentOrg();
  const db = getDb();
  const adminRow = await db.query.platformAdmins.findFirst({
    where: eq(platformAdmins.userId, user.id),
  });
  return { user, membership, organization, isPlatformAdmin: Boolean(adminRow) };
}
```

Keep `getCurrentOrg()` as-is so the sidebar (which doesn't care about admin status) stays cheap.

In the sidebar, when `isPlatformAdmin` is true, show a small pill below the org name: `Platform admin`. Wired by calling `getCurrentContext()` instead of `getCurrentOrg()` in `app/(app)/layout.tsx` (one-line change).

### Step 9 — Read-time audit (app side, best-effort)

When a platform admin enters an `(app)/*` route belonging to an org they aren't a member of, insert a row into `platform_admin_audit` with `operation='SELECT'`. Implement as a side effect in `getCurrentContext()` once we have routes that scope to a specific org (not in sprint 03 since every page still resolves the admin's own membership).

For now, document the hook point in code with a `TODO(sprint-04):` comment so the future per-company page in sprint 04 wires it.

### Step 10 — Tests (Vitest setup + RLS suite)

Install Vitest and a small Postgres helper:

```bash
npm install -D vitest @vitest/coverage-v8
```

Add `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@/": new URL("./", import.meta.url).pathname },
  },
});
```

Add `tests/setup.ts` that loads `.env.local` and connects to the local DB.

The core RLS test (`tests/rls/multi-tenant.test.ts`) does:

1. Boot a connection as the `authenticated` role with `request.jwt.claims` set to a fake "user from org A".
2. Insert org A + a row in `organization_members`.
3. Insert org B + a member.
4. Assert: user A's connection sees only org A's rows (`SELECT count(*) FROM organizations` → 1).
5. Switch the JWT to user B → sees only org B's rows.
6. Grant user A platform-admin → now sees both orgs.
7. Attempt a cross-org `UPDATE` as user A (platform admin) → expect zero rows updated (write default-deny holds).
8. Assert: a row appeared in `platform_admin_audit` for that attempt (or didn't, depending on whether the policy short-circuits before the trigger fires — verify and document).

The exact mechanism for "act as user A" in Postgres is:

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<user-a-uuid>","email":"a@x.com"}';
```

Wrap that in a tiny test helper.

`npm run test` script wired in `package.json`.

### Step 11 — Convention doc

Create `docs/conventions/rls.md` with the canonical patterns:

```
For every new business table T with column organization_id:

ALTER TABLE T ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_T" ON T FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);

CREATE POLICY "write_T" ON T FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);

CREATE TRIGGER trg_T_admin_audit
  AFTER INSERT OR UPDATE OR DELETE ON T
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();

-- Optionally open cross-org writes only if the product needs it:
-- CREATE POLICY "platform_admin_write_T" ON T FOR ALL
--   USING (public.is_platform_admin())
--   WITH CHECK (public.is_platform_admin());
```

Sprint 04+ will copy this verbatim per table.

### Step 12 — Lint + build + implementation notes

`npm run lint`, `npm run build`, `npm run test` all clean. Fill the implementation notes at the bottom of this brief.

## Acceptance criteria

- [ ] `platform_admins` + `platform_admin_audit` tables created with RLS enabled
- [ ] `is_platform_admin()` SQL function returns boolean and reads `auth.uid()` via `STABLE SECURITY DEFINER`
- [ ] Updated `organizations` and `organization_members` policies use the helper
- [ ] FK from `platform_admins.user_id` to `auth.users(id)` exists
- [ ] Generic audit trigger `log_platform_admin_write()` exists and is attached to both tables
- [ ] `npm run db:grant-platform-admin -- ludovic@leonandgeorge.com "..."` succeeds
- [ ] `npm run db:revoke-platform-admin -- ludovic@leonandgeorge.com` works symmetrically
- [ ] Sidebar shows a "Platform admin" pill when logged in as Ludovic
- [ ] Vitest is installed, `npm run test` runs the RLS suite, all five guarantees pass
- [ ] `docs/conventions/rls.md` exists and is referenced from `docs/architecture.md`
- [ ] `npm run lint` and `npm run build` clean

## Things to verify before declaring done

- A user without any `organization_members` row sees zero rows when querying any business table — even via the anon JWT directly against the REST API.
- A platform admin who isn't in `organization_members` for a target org: reads work, writes fail.
- The audit table has a row after a platform admin performs a cross-org write attempt (if the policy short-circuits before write, document that the trigger may not fire and decide whether app-side logging is needed).
- `getCurrentContext()` is the only place that resolves admin status — no direct `platformAdmins` query scattered through the codebase.

## Implementation notes

Executed in one pass, ~1.5h.

**Migration order matters.** The migration first creates `platform_admins`, then adds `is_platform_admin()` (which queries that table), then updates the existing `organizations` / `organization_members` policies to call the helper, then adds the audit trigger function and attaches it. Reverse any of these and you get either a missing-table error (helper before table) or a missing-function error (policy before helper).

**Drizzle doesn't model cross-schema FKs.** `platform_admins.user_id → auth.users(id)` is added by raw SQL inside the migration (`ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES auth.users(id)`). Drizzle's introspection won't see it, which is fine — the FK is enforced at the DB level regardless.

**`db:reset` does not wipe `auth.users`.** Only the `public` schema is dropped & recreated. After a reset, the previously-created `ludovic@leonandgeorge.com` still existed in `auth.users` but had no `organization_members` row anymore. `npm run db:create-user` failed because the email was taken. Fix: ran `db:delete-user` first, then `db:create-user`. **Followup**: add a `db:reset:full` script that also clears `auth.users` for clean dev resets. (Not done this sprint to keep diffs focused.)

**Kong's upstream cache.** After `supabase db reset`, Kong (the API gateway in front of Auth/REST/Storage) kept connecting to the old Auth container IP, returning `502 An invalid response was received from the upstream server`. Fix: `docker restart supabase_kong_hitempo`. This is a known Supabase-CLI quirk during `db reset`. If it happens again, the same restart fixes it.

**Audit trigger fires only on successful writes.** A platform admin attempting a cross-org `UPDATE` on `organizations` is blocked by the `write_organizations` policy BEFORE the row gets touched, so the `AFTER UPDATE` trigger never fires. That's correct behavior: the write didn't happen, there's nothing to audit. The trigger earns its keep starting sprint 04+ when individual tables explicitly open cross-org writes via `OR is_platform_admin()` on their write policy (`support_notes` will be the first example).

**`organizations` is a special case in the trigger.** Other business tables have an `organization_id` column. The `organizations` table itself doesn't — the row IS the org. The trigger function detects `TG_TABLE_NAME = 'organizations'` and uses `id` instead of `organization_id`. Documented in the function body. Sprint 04+ tables won't need this branch.

**Test isolation pattern.** The Vitest suite uses `randomUUID()` for every user/org id so reruns don't collide. Setup inserts into `auth.users` directly via the service-role connection (RLS bypassed, no need for the Auth Admin API for these test-only users). Cleanup in `afterAll` deletes in FK order. Each test acquires its own `openRlsClient()` and closes it. Tests run in ~150ms total.

**Test 5 documents an absent guarantee.** The default-deny posture means the audit trigger doesn't fire for the cross-org `UPDATE` attempt in test 4 — the policy stops the write before the AFTER trigger runs. Test 5 verifies that the audit table is reachable and that non-admins can't read it; the actual cross-org write path will be tested per-table starting sprint 04+, when individual tables open cross-org writes.

**`getCurrentContext()` vs `getCurrentOrg()`.** Kept both. `getCurrentOrg()` is the cheap path (1 query) and is what most Server Components want. `getCurrentContext()` is the elevated path (2 queries) and only the `(app)/` layout calls it, so the admin pill is computed once per page load, not per Server Component. The split avoids paying for the platform-admin check 30 times per dashboard render.

**TypeScript build vs Vitest.** `next build` runs `tsc` against everything in `tsconfig.json`'s `include`. The test helper `tests/helpers/rls-client.ts` uses `tx.unsafe(sql, params: unknown[])` which `next build` flagged as a type error (the underlying `postgres-js` signature is narrower than what Vitest tolerates). Fix: excluded `tests/` from the root `tsconfig.json` and added a separate `tests/tsconfig.json` that extends it. Vitest uses the root tsconfig by default but doesn't actually run the strict TS check during `vitest run`, so this is purely a `next build` accommodation.

**Verification done locally.**
- `npm run lint` — 0 warning
- `npm run build` — clean (after excluding `tests/`)
- `npm run test` — 6 tests pass in ~150ms (5 RLS guarantees + 1 isolation variant)
- Manual: opened Studio at `http://127.0.0.1:54323`, verified `platform_admins`, `platform_admin_audit`, `is_platform_admin()` function, `log_platform_admin_write()` function, and the two triggers all exist
- `npm run db:grant-platform-admin -- ludovic@leonandgeorge.com "Founder — bootstrap"` succeeded; Ludovic is now in `platform_admins`

**Outstanding for Ludovic (browser visual check)**

Reload `/dashboard` after logging back in. Below "LÉON & GEORGE" in the sidebar there should now be a small amber pill `● Platform admin`. If you don't see it, your Next.js dev server may be cached — Ctrl+C and `npm run dev` again. To verify the elevated path actually works, you can `npm run db:revoke-platform-admin -- ludovic@leonandgeorge.com` and reload — the pill disappears. Re-grant when done playing.

**Follow-ups**

- Sprint 04: copy the four-statement pattern from `docs/conventions/rls.md` for every new table (`companies`, `sites`, `contacts`). Add a corresponding `tests/rls/<table>.test.ts` per table.
- Wire the read-time audit at the location of the `TODO(sprint-04):` comment in `lib/auth/context.ts` once we have a per-org page (probably `/companies/[id]`).
- Add a `db:reset:full` npm script that ALSO wipes `auth.users` for clean dev resets.
- The mid-test cleanup ordering (`afterAll`) is brittle for tables with FKs. Consider a `truncate` helper that does `TRUNCATE ... RESTART IDENTITY CASCADE` for the tables we created in this run, gated by env to never run against prod.
- The Kong upstream-cache issue should be added to a "Local stack troubleshooting" doc — easy to forget.

## What's next

**Sprint 04 — Companies, sites, contacts (CRUD).** With the RLS convention in place, sprint 04 adds the three core business tables, applies the `read_T / write_T / trg_T_admin_audit` pattern to each, and ships the first real list + detail + form screens.

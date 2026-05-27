# RLS convention — every new business table

This is the canonical recipe for adding Row Level Security to a new table in hitempo. Sprint 03 set up the helpers (`user_organization_ids()`, `is_platform_admin()`, `log_platform_admin_write()`) once. Every business table from sprint 04 onward must follow this convention.

If you're tempted to deviate, read `docs/architecture.md` → "Multi-tenancy" and "Platform admin pattern" first. Then come back and explain why in the migration comment.

## The pattern (copy-paste, then adapt)

For a new business table `T` that carries `organization_id`:

```sql
-- 1. Enable RLS. No table without this clause.
ALTER TABLE "T" ENABLE ROW LEVEL SECURITY;

-- 2. Read policy: members of the org, OR platform admins.
CREATE POLICY "read_T" ON "T" FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);

-- 3. Write policy: org members only — DEFAULT DENY for platform admins.
--    Open cross-org writes only when the product demands it (see "Exceptions").
CREATE POLICY "write_T" ON "T" FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);

-- 4. Audit trigger for cross-org writes by platform admins.
CREATE TRIGGER "trg_T_admin_audit"
  AFTER INSERT OR UPDATE OR DELETE ON "T"
  FOR EACH ROW EXECUTE FUNCTION public.log_platform_admin_write();
```

That's the whole recipe. Four statements, copy-paste, change `T` to the table name, ship.

## Schema requirement

Every business table must have:

```typescript
organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
```

Index it if you'll filter or join on it heavily (most tables will):

```typescript
}, (t) => ({
  byOrg: index("idx_T_org").on(t.organizationId),
}));
```

## App-side rule (defense in depth)

Even with RLS in place, **always filter explicitly** in queries:

```typescript
// Correct
db.select().from(T).where(eq(T.organizationId, ctx.organization.id));

// Wrong — relies on RLS only, makes the intent invisible to reviewers
db.select().from(T);
```

Why both: performance (the planner uses your filter immediately), code review clarity, and survival if a future refactor accidentally loosens RLS.

## Exceptions: when to open cross-org writes for platform admins

Default: closed. A platform admin can read everywhere but cannot write to an org they're not a member of.

Open it only for tables where the **product** explicitly needs hitempo staff to write to a customer's data without joining their org. Examples that might justify it:

- A `support_notes` table where hitempo staff annotates customer orgs (read by both staff and the customer).
- A `feature_flags` table flipped by hitempo for individual customers.

To open cross-org writes, **add a second write policy** alongside the default one — never replace it:

```sql
CREATE POLICY "platform_admin_write_T" ON "T" FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
```

When you do this, the audit trigger automatically captures every cross-org write into `platform_admin_audit`. That's the whole point of the trigger.

**Tables that should never open cross-org writes** (a partial list):
- `organizations` — only the owners change their own org settings
- `organization_members` — invitations and role changes happen inside the org
- `messages` / `interactions` / `tasks` — staff doesn't ghostwrite customer correspondence
- Anything financial (`opportunities`, `ai_usage`) — staff doesn't book revenue on behalf of a customer

## Read-time audit (app-side)

Postgres has no `SELECT` trigger. When a platform admin reads data for an org they're not a member of, the DB silently allows it (that's the read escape hatch). To track that, the **app layer** logs:

- Where: in any Server Component or Server Action that resolves `getCurrentContext()` for a specific target org and detects `isPlatformAdmin === true && targetOrgId !== membership.organizationId`.
- What: insert into `platform_admin_audit` with `operation = 'SELECT'`.
- Best-effort: don't block the request if the log insert fails. Log via `console.error` and continue.

Sprint 03 left a `TODO(sprint-04):` marker in `lib/auth/context.ts` for the per-company page case. Wire it there.

## How to verify a new table's RLS

The `tests/rls/multi-tenant.test.ts` suite tests `organizations` and `organization_members`. When you add table `T`, copy that file as `tests/rls/T.test.ts` and adjust:

- Insert two test rows (one for org A, one for org B).
- Assert user A only reads org A's row.
- Assert user A cannot UPDATE org B's row.
- Assert a platform admin reads both rows.
- Assert a platform admin cannot UPDATE org B's row (unless you explicitly opened cross-org writes — then assert the audit row appears).

`npm run test` must stay green.

## Anti-patterns to flag in code review

- A new table without `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the migration.
- A new table without a `read_T` and `write_T` policy.
- A new policy that uses `auth.uid()` directly instead of `user_organization_ids()` or `is_platform_admin()`.
- A query in `(app)/*` that doesn't filter by `organization_id` even though RLS would catch it.
- A Server Action that uses `getAdminDb()` (service role bypasses RLS — only legal for Inngest workers, migrations, and the seed/create-user scripts).
- A new platform-admin write policy without an accompanying test that asserts the audit row appears.

## Where the helpers live

- `public.user_organization_ids()` — returns the org ids the current `auth.uid()` is a member of. Defined in `supabase/migrations/<timestamp>_init_organizations.sql`.
- `public.is_platform_admin()` — boolean, returns true iff `auth.uid()` is in `platform_admins`. Defined in `supabase/migrations/<timestamp>_platform_admins.sql`.
- `public.log_platform_admin_write()` — trigger function attached to every business table. Same migration as above.

If you ever change one of these helpers, write a separate migration with the diff (don't edit the old migration file — those are immutable once applied).

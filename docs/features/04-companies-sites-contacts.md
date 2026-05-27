# Sprint 04 — Companies, sites, contacts (CRUD)

The first real features. We land the three core business tables, apply the RLS recipe from sprint 03 (verbatim, four statements per table), seed a handful of plausible L&G prospects, and ship full CRUD UI for each. Sidebar counters become real. The placeholder pages from sprint 02.5 are replaced by working list + detail + create + edit + delete flows.

## Scope choices (confirmed with Ludovic)

- **3 tables only**: `companies`, `sites`, `contacts`. We deliberately defer `segments` and `micro_zones` to a later sprint — `segment_id` and `micro_zone_id` stay as nullable UUID columns without FKs for now, ready to be tied once those tables ship.
- **Full CRUD**: list + detail + create + edit + delete (soft delete via `deleted_at`) for all three. Sites are managed inline inside the company detail page (no standalone `/sites` route — they don't make sense outside their company context).
- **Real sidebar counters**: queries instead of `// PLACEHOLDER: 0`.

## Goals

1. Migration `0002_companies_sites_contacts` adding:
   - 3 enums: `company_relationship_type`, `site_type`, `contact_role`
   - 3 tables with all the columns from `docs/data-model.md` (companies, sites, contacts)
   - For each: `ENABLE RLS`, `read_T`, `write_T` policies, audit trigger (the canonical 4-statement recipe)
2. Drizzle schema + relations updated; types auto-derived from schema
3. Query helpers under `db/queries/`:
   - `companies.ts` — `listByOrg`, `getById`, `getWithSitesAndContacts`
   - `sites.ts` — `listByCompany`
   - `contacts.ts` — `listByOrg`, `listByCompany`, `getById`
4. Server Actions under `lib/actions/`:
   - `companies.ts` — `createCompany`, `updateCompany`, `deleteCompany` (soft)
   - `sites.ts` — `createSite`, `updateSite`, `deleteSite`
   - `contacts.ts` — `createContact`, `updateContact`, `deleteContact` (soft)
   All inputs Zod-validated; all filtered by `activeOrganization.id` from `getActiveOrg()`.
5. Pages:
   - `/companies` — list with score + status + signal + segment label; click row → detail
   - `/companies/new` — create form
   - `/companies/[id]` — detail with sites table + contacts table inline + edit/delete buttons
   - `/companies/[id]/edit` — edit form
   - `/contacts` — list with company + role + status + last-contacted timestamp
   - `/contacts/new` — create form (with company selector)
   - `/contacts/[id]` — detail
   - `/contacts/[id]/edit` — edit form
   - Sites: create + edit forms shown inline on company detail, not as standalone routes
6. Sidebar counters become real: `SELECT count(*) WHERE organization_id = ? AND deleted_at IS NULL` for companies, contacts, and (placeholder still) tasks
7. Demo seed: `db/seed-demo-data.ts` adds 4 companies, 5 sites, 8 contacts to L&G with realistic French data matching the dashboard mockup. Bristol gets 1 company + 1 contact so impersonation actually shows different data.
8. Tests: per-table RLS tests prove user A can't see / write to user B's companies, sites, contacts. Plus one test that a platform admin sees zero rows from `/companies` for their own account (they need to impersonate first).

## Out of scope

- `segments` + `micro_zones` tables and their UI (later sprint)
- Scoring computation — the `score` column exists, but it's null or hand-set in seeds. Sprint 06 wires the real scoring.
- `interactions`, `tasks`, `messages` — sprint 05
- Search (the `⌘K` searchbar in the topbar stays decorative)
- Bulk import (CSV/Excel) — sprint 09
- Filters and column sorting in lists — basic order-by-name only this sprint, advanced filters come with sprint 06's scoring views
- Pagination — lists return up to 200 rows, no cursor pagination yet (premature for the data volumes we have)
- File uploads (logos) — sprint TBD

## Key design decisions

**Soft delete.** Both `companies` and `contacts` have `deleted_at` columns. Delete actions set `deleted_at = now()`, never actually `DELETE`. All read queries add `WHERE deleted_at IS NULL`. Sites cascade-delete with their company; they don't get their own soft-delete column (a site without a company is incoherent).

**Multi-step ownership chain.** `contacts.company_id` is `NOT NULL` and references `companies(id) ON DELETE CASCADE`. `contacts.site_id` is nullable, `ON DELETE SET NULL`. Same shape for sites under companies. RLS only checks `organization_id` — the cascade ensures consistency.

**`organization_id` on every business table even when derivable.** A contact's org could be derived through `company.organization_id`. We carry it on `contacts` anyway, denormalized. Reason: RLS policies stay flat and identical across tables (the convention's whole point), and queries by org don't have to traverse joins. Sprint 03's RLS recipe assumes `organization_id` is on the row.

**Generated column for `full_name`.** `contacts.full_name = first_name || ' ' || last_name`, stored generated. Lets the list page sort and filter on a single text column instead of computing in JS or applying functions in WHERE clauses.

**Server Actions filter by active org, not by membership.** Every CRUD action calls `getActiveOrg()` and stamps `organization_id` from `activeOrganization.id`. This is what makes the platform-admin impersonation actually work: when the admin is inspecting Bristol's data, a "Create company" form creates the company under Bristol, not under their own org. RLS still enforces the truth at the DB layer.

**Forms are Server Actions.** Every form posts to a Server Action via `<form action={...}>`. No client-side state, no API routes, no separate fetch calls. The action validates with Zod, mutates, calls `revalidatePath()`, and redirects.

**Lists are Server Components.** No client-side data fetching. The page reads the query directly from the DB on the server, renders the table HTML. Sorting and filtering at this stage are URL search params (one-line `searchParams` plumbing).

## Implementation plan

### Step 1 — Schema additions (`db/schema.ts`)

Add the three enums:

```typescript
export const companyRelationshipType = pgEnum("company_relationship_type", [
  "prospect", "client", "former_client", "prescriber", "partner",
]);

export const siteType = pgEnum("site_type", [
  "office", "hotel", "showroom", "store", "restaurant", "warehouse", "other",
]);

export const contactRole = pgEnum("contact_role", [
  "decision_maker", "influencer", "user", "prescriber", "assistant", "other",
]);
```

Then the three tables (full columns per data-model.md), plus relations:

```typescript
export const companies = pgTable("companies", { ... });
export const sites = pgTable("sites", { ... });
export const contacts = pgTable("contacts", { ... });

// Relations so .findFirst({ with: { sites: true, contacts: true } }) works.
export const companiesRelations = relations(companies, ({ one, many }) => ({
  organization: one(organizations, { fields: [companies.organizationId], references: [organizations.id] }),
  parent: one(companies, { fields: [companies.parentId], references: [companies.id], relationName: "parent" }),
  children: many(companies, { relationName: "parent" }),
  sites: many(sites),
  contacts: many(contacts),
}));
export const sitesRelations = relations(sites, ({ one, many }) => ({
  organization: one(organizations, { fields: [sites.organizationId], references: [organizations.id] }),
  company: one(companies, { fields: [sites.companyId], references: [companies.id] }),
  contacts: many(contacts),
}));
export const contactsRelations = relations(contacts, ({ one }) => ({
  organization: one(organizations, { fields: [contacts.organizationId], references: [organizations.id] }),
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
  site: one(sites, { fields: [contacts.siteId], references: [sites.id] }),
}));
```

### Step 2 — Migration + hand-augment SQL

```bash
npm run db:generate -- --name companies_sites_contacts
```

Append to the generated SQL the canonical 4-statement RLS recipe for each table (copy from `docs/conventions/rls.md`). Also add the generated column for `contacts.full_name`:

```sql
ALTER TABLE contacts DROP COLUMN full_name;
ALTER TABLE contacts ADD COLUMN full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
```

(Drizzle generates `full_name` as a normal column; we re-add it as STORED generated. Drizzle can describe generated columns since `0.30+`, but we keep the manual SQL for clarity.)

Then sync + reset + reseed users + run demo seed.

### Step 3 — Demo seed

`db/seed-demo-data.ts`:

```typescript
// For L&G: 4 companies (Hôtel Westminster, Exotrail, Studio Marc Hertrich, Wojo Madeleine)
// Each gets a primary site, some get a secondary site
// Each gets 2-3 contacts (Sophie Durand, Alexandre Braud, Christophe Daudré, etc.)

// For Hôtel Le Bristol (the demo org): 1 company + 1 site + 1 contact
// So impersonating Bristol actually shows different data
```

Wire `"db:seed-demo-data": "tsx db/seed-demo-data.ts"`.

### Step 4 — Query helpers (`db/queries/`)

```typescript
// db/queries/companies.ts
export async function listCompaniesByOrg(orgId: string) {
  return getDb().query.companies.findMany({
    where: and(eq(companies.organizationId, orgId), isNull(companies.deletedAt)),
    orderBy: [desc(companies.score), asc(companies.name)],
    limit: 200,
  });
}

export async function getCompanyWithDetails(orgId: string, companyId: string) {
  return getDb().query.companies.findFirst({
    where: and(eq(companies.id, companyId), eq(companies.organizationId, orgId), isNull(companies.deletedAt)),
    with: {
      sites: { orderBy: [desc(sites.isPrimary), asc(sites.name)] },
      contacts: {
        where: isNull(contacts.deletedAt),
        orderBy: [desc(contacts.relevance), asc(contacts.lastName)],
      },
    },
  });
}
```

Similar for sites and contacts.

### Step 5 — Server Actions (`lib/actions/`)

Pattern (companies example):

```typescript
"use server";
const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  industry: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

export async function createCompany(formData: FormData) {
  const parsed = createCompanySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "invalid_input" };
  }
  const { activeOrganization } = await getActiveOrg();
  const db = getDb();
  const [row] = await db.insert(companies).values({
    organizationId: activeOrganization.id,
    name: parsed.data.name,
    legalName: parsed.data.legalName || null,
    websiteUrl: parsed.data.websiteUrl || null,
    industry: parsed.data.industry || null,
    notes: parsed.data.notes || null,
  }).returning();
  revalidatePath("/companies");
  redirect(`/companies/${row.id}`);
}
```

`updateCompany(id, formData)` and `deleteCompany(id)` follow. Soft-delete is `UPDATE companies SET deleted_at = now() WHERE id = ?` filtered by `organization_id` for defense in depth.

### Step 6 — Pages

Routes:

```
app/(app)/companies/
  page.tsx                    # list
  new/page.tsx                # create form
  [id]/
    page.tsx                  # detail (sites + contacts inline)
    edit/page.tsx             # edit form
app/(app)/contacts/
  page.tsx                    # list
  new/page.tsx                # create form
  [id]/
    page.tsx                  # detail
    edit/page.tsx             # edit form
```

Standard pattern per page:
- Read `activeOrganization` via `getActiveOrg()`
- Fetch data via the relevant query helper
- Render with `<PageHeader>` + table or form (shadcn primitives)
- Forms post to Server Actions, with hidden `id` input for edits

For tables: a thin reusable `<DataTable>` would be nice but premature. Hand-coded HTML tables with Tailwind classes are fine until we have 4+ list pages that share patterns. The companies list and contacts list will look similar — we keep them as-is for now.

### Step 7 — Sidebar counters → real

`components/app/sidebar.tsx` becomes async (already is) and queries:

```typescript
const [companiesCount, contactsCount] = await Promise.all([
  getDb().select({ c: count() }).from(companies)
    .where(and(eq(companies.organizationId, organization.id), isNull(companies.deletedAt))),
  getDb().select({ c: count() }).from(contacts)
    .where(and(eq(contacts.organizationId, organization.id), isNull(contacts.deletedAt))),
]);
```

`tasks` stays `// PLACEHOLDER:` until sprint 05. The placeholder is on `tasks` only; the rest are real.

If `organization` is null (pure platform admin), the counters skip — they're not relevant.

### Step 8 — Tests

`tests/rls/business-tables.test.ts` covers all three tables in one file (DRY since the pattern is identical):

1. user A inserts a company in org A; user B can't read it
2. user A inserts a site under that company; user B can't read it
3. user A inserts a contact; user B can't read it
4. user B attempts UPDATE on any of A's rows → 0 rows updated
5. A platform admin (no membership) reading `companies` returns 0 rows by default (because they have no `organization_id IN (...)` match, and the platform admin clause is just `OR`)
6. A platform admin who has impersonated org A (scoped the app query to `WHERE organization_id = orgA`) sees A's companies — exactly what the app does

### Step 9 — i18n keys

Add to `messages/{en,fr}.json` under `pages.companies.*`, `pages.contacts.*`, `forms.*`, `actions.*` (create, edit, delete, cancel). Several dozen new keys — accept the volume, it's the price of the i18n discipline.

### Step 10 — Lint + build + test + implementation notes

Standard close.

## Acceptance criteria

- [ ] Migration `0002_companies_sites_contacts` applied; tables `companies`, `sites`, `contacts` exist with RLS + audit triggers
- [ ] `npm run db:seed-demo-data` populates 4 L&G companies, 5 sites, 8 contacts + 1 Bristol company, 1 site, 1 contact
- [ ] `/companies` shows the 4 L&G companies as Ludovic@leonandgeorge (the score+status+signal columns are populated where seeded, blank otherwise)
- [ ] `/companies/[id]` shows sites and contacts for that company
- [ ] `/companies/new` creates a company; redirect to detail; sidebar counter increments
- [ ] `/companies/[id]/edit` updates a company; revalidate is correct
- [ ] Delete on a company hides it from lists (soft delete); sidebar counter decrements
- [ ] Same for `/contacts/*` and inline sites in company detail
- [ ] As `ludovic@fourthscale.com` (pure platform admin), impersonating Bristol shows Bristol's 1 company, not L&G's 4
- [ ] As ludovic@fourthscale with **no** impersonation, `/companies` etc. redirect to `/admin/orgs` (no active org)
- [ ] Sidebar counters reflect the active org (not the user's own org)
- [ ] `npm run lint`, `npm run build`, `npm run test` all clean — test count goes from 6 to ~12

## Implementation notes

Executed in one pass. Biggest sprint so far in terms of LOC + screens.

**Schema decisions that bit me.**
- `contacts.full_name` is a STORED generated column. Drizzle's `.generatedAlwaysAs()` support is inconsistent across versions, so I dropped it from the TS schema and added it in raw SQL after the generate. Side effect: it doesn't appear in TS `typeof contacts.$inferSelect` — if needed in queries, select it explicitly via `sql<string>`.
- `companies.parent_id` is a self-referencing FK. Drizzle didn't emit the FK constraint in the generated SQL (cross-table self-refs are not always introspected). Added by hand.
- `companies.segment_id` and `sites.micro_zone_id` are kept as nullable UUIDs without FK (segments / micro_zones tables come in a later sprint). The schema columns are present so we don't need a migration later — just add the FK then.

**Server Action return type contract changed.** Initial version returned `{ ok, error }` on validation failure, redirected on success. Next.js 16's `<form action>` strictly types its handler as `(formData) => Promise<void> | void`. The discriminated return was a TS error. Switched all actions to `throw new Error("invalid_input")` on Zod failure; success still uses `redirect()` (which throws internally so technically returns `never`). Production UX: a Zod fail today produces a Next.js error boundary, which is ugly but loud. Future: wrap actions with a tiny `formAction()` helper that catches and redirects with `?error=` query param. **Not done this sprint — flagged as a follow-up.**

**`emptyToNull` normalization.** HTML forms can't send `null` directly; an empty `<input>` sends `""`. Each action normalizes empty strings to `null` before insert/update so nullable columns aren't filled with empty strings. Tiny helper inline in each action file — could move to `lib/utils/forms.ts` if more patterns emerge.

**Reusable form components.** `<CompanyForm>`, `<ContactForm>`, `<SiteForm>` each take a Server Action prop and an optional `initial` row. Same component handles both create (no `initial`) and edit (`initial` populated + hidden `id`). Avoids two near-identical components per resource. Note: type signature is `(formData: FormData) => Promise<void> | void` — anything else fails TS.

**Sites use inline forms, not standalone routes.** The site form is wrapped in a `<details>` collapsible on the company detail page. Less polished than a dedicated edit modal but ships fast and keeps users in-context. Edit a site is currently not exposed in UI (only create + delete); user has to delete + re-create to "edit". **Follow-up**: add a Site edit form inline or as `/companies/[id]/sites/[siteId]/edit`. Acceptable trade-off for sprint 04 close.

**Sidebar counters honor active org.** `Sidebar` receives the `organization` prop from `(app)/layout.tsx`, which gets it from `getActiveOrg()`. Inside the sidebar component, `countCompaniesByOrg(organization.id)` and `countContactsByOrg(organization.id)` run on every layout render (no caching). For sub-200-row workloads that's fine; if it gets hot, we cache or revalidate per route.

**Demo seed.** `db/seed-demo-data.ts` creates 4 L&G companies (Westminster, Exotrail, Studio Marc Hertrich, Wojo Madeleine) with 5 sites and 8 contacts. Hôtel Le Bristol gets 1 company (Plaza Athénée), 1 site, 1 contact. The Bristol asymmetry is intentional: when impersonating Bristol, the lists look meaningfully different from L&G's — proves the active-org filter works at every list query.

**RLS test set extended.** `tests/rls/business-tables.test.ts` covers the new tables (5 isolation tests + 1 sanity check on `full_name`). Total test count is now 12 (6 sprint-03 + 6 sprint-04). All pass in ~320ms.

**Verification done locally.**
- `npm run lint` — 0 warning
- `npm run build` — 18 routes built, including 8 new ones under /companies and /contacts
- `npm run test` — 12/12 green
- DB has L&G + Bristol orgs with demo data; `ludovic@leonandgeorge.com` (owner L&G) and `ludovic@fourthscale.com` (pure platform admin) both recreated
- Sidebar counters show 4 companies and 8 contacts for L&G in the local DB

**Outstanding for Ludovic (browser smoke test)**

Restart `npm run dev` (you accumulated a lot of structural changes), then log in as `ludovic@leonandgeorge.com` / `TempPass123!`. Expected:

1. Sidebar now shows `Entreprises 4`, `Contacts 8` (real counters)
2. `/companies` lists Westminster (88), Studio Marc Hertrich (86), Exotrail (82), Wojo Madeleine (81), ordered by score desc
3. Click Westminster → detail page with company info, the signal banner, 1 site (the Paris Opéra hotel), 2 contacts
4. Click "Edit" → form pre-filled → change a field → save → redirect to detail with new value
5. Click "+ Nouvelle entreprise" (topbar) → form → create a company → land on its detail page
6. Add a site via the inline form on a company detail → reload, site appears
7. `/contacts` lists 8 contacts grouped (sortable visually by relevance), click any contact → detail
8. Edit a contact, change the company assignment → save → detail reflects the new company
9. Soft delete a company → disappears from `/companies` and sidebar count drops
10. Then `ludovic@fourthscale.com` / `TempPass123!`: lands on `/admin/orgs`, click Enter on **Hôtel Le Bristol** → orange banner + `/companies` now shows just **Plaza Athénée** (Bristol's only seeded company). Counters in sidebar show `Entreprises 1`, `Contacts 1`. Switch to L&G → counters back to 4 / 8. Proof that active-org scoping works end-to-end.

**Follow-ups for next sprints**

- Sprint 05 (Interactions & tasks): wire the `tasks` counter; populate the dashboard's "À traiter aujourd'hui" with real data.
- Move soft-delete + `updated_at` automation into Drizzle defaults or triggers (currently each action sets them by hand — works, but begs for a `withTimestamps` mixin).
- Build a `formAction()` wrapper that catches validation errors and redirects with `?error=`. Replaces the current `throw new Error()` approach for a real UX.
- Add Site edit form (inline or `/companies/[id]/sites/[siteId]/edit`).
- Add `companies` and `contacts` filters (status, score range, segment) once we have signal volume.
- The `tests/rls/multi-tenant.test.ts` and `tests/rls/business-tables.test.ts` insert directly into `auth.users` for test fixtures. Works, but if Supabase adds required columns we break. Consider a `testSetupUsers()` helper that goes through `auth.admin.createUser`.
- Migration: `segment_id` and `micro_zone_id` will need FK constraints added when those tables ship. The columns exist; just add `ALTER TABLE ... ADD CONSTRAINT`.

## What's next

**Sprint 05 — Interactions & tasks.** With companies + contacts in place, sprint 05 adds the touch log (emails sent, calls made, visits) and the task system that drives the dashboard's "À traiter aujourd'hui" list. The pieces of the dashboard mockup start filling in for real instead of via the `// PLACEHOLDER:` data.

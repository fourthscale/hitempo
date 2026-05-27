# Architecture — hitempo

This document explains the architectural decisions and patterns. Read this once before implementing any feature.

## Overall topology

```
   ┌──────────────────────────────────────────┐
   │  Browser (commercial user)               │
   │  Next.js client + Server Components      │
   └─────────────────┬────────────────────────┘
                     │
              ┌──────▼───────┐
              │  Vercel Edge │
              └──────┬───────┘
                     │
        ┌────────────┴─────────────┐
        │  Next.js Server          │
        │  Server Components       │
        │  Server Actions          │
        │  Route Handlers          │
        └─┬──────┬─────┬────┬──────┘
          │      │     │    │
          ▼      ▼     ▼    ▼
    ┌──────┐ ┌─────┐ ┌──┐ ┌──────────────┐
    │Supab.│ │Inng.│ │AI│ │External APIs │
    │PG+RLS│ │jobs │ │  │ │Resend, GMail │
    │Auth  │ │     │ │  │ │Dropcontact   │
    │Stor. │ │     │ │  │ │Smartlead V1+ │
    └──────┘ └─────┘ └──┘ └──────────────┘
```

## Multi-tenancy (the most important section)

### Principle

Every business table carries `organization_id`. Supabase Row Level Security (RLS) enforces that authenticated users can only read/write rows where `organization_id` matches one of the orgs they're a member of.

### Tables involved

- `organizations` (id, slug, name, plan, brand_brief JSON, default_locale, supported_locales, settings JSON)
- `organization_members` (organization_id, user_id, role) — links Supabase Auth users to orgs

Every other business table (`companies`, `sites`, `contacts`, `interactions`, etc.) carries `organization_id NOT NULL` with a FK to `organizations.id`.

### RLS policy pattern

For every business table, two policies minimum:

```sql
-- SELECT
CREATE POLICY "users_can_read_own_org" ON companies
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE
CREATE POLICY "users_can_write_own_org" ON companies
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
```

A helper function in Postgres makes this cleaner:

```sql
CREATE FUNCTION user_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
$$;
```

Then policies reduce to `organization_id IN (SELECT user_organization_ids())`.

### Client filtering (defense in depth)

Even with RLS in place, **all application queries explicitly filter by `organization_id`**:

```typescript
// ✅ Correct
const companies = await db.select().from(schema.companies)
  .where(eq(schema.companies.organizationId, ctx.organizationId));

// ❌ Wrong — relies on RLS only
const companies = await db.select().from(schema.companies);
```

Why both? Defense in depth, performance (Postgres uses the index without going through RLS overhead first), explicit intent.

### Current organization context

The "current org" is resolved server-side from the user session. A typical pattern:

```typescript
// lib/auth/context.ts
export async function getCurrentOrg() {
  const user = await getCurrentUser();
  if (!user) throw new Error("not authenticated");

  const membership = await db.query.organizationMembers.findFirst({
    where: eq(schema.organizationMembers.userId, user.id),
    with: { organization: true }
  });

  if (!membership) throw new Error("no org membership");
  return membership.organization;
}
```

At MVP there's only one org per user (L&G). At V1+ users may belong to multiple orgs; we'll add an org switcher.

## Platform admin pattern (cross-org access)

**The problem.** RLS confines every authenticated user to their `organization_members` rows. That's the whole point — it's the multi-tenant guarantee. But the hitempo team (support, debugging, billing investigations, content moderation) needs to read across all organizations. RLS, on purpose, makes that impossible for a normal user.

**Distinction first.** Don't conflate the two flavors of "admin":

- **Org admin** — a member with `organization_members.role IN ('owner', 'admin')`. Elevated CRUD rights *inside their org only*. RLS handles them perfectly: they only ever see their org's data.
- **Platform admin** — a hitempo employee (Ludovic, future support team). Needs cross-org read access. This is what this section is about.

**Chosen pattern (MVP onwards): `is_platform_admin()` helper + table.**

Implemented in sprint 03 (Multi-tenancy & RLS), alongside the per-table policies. Schema:

```sql
CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  note text
);

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
$$;
```

Every business-table policy then combines tenant scoping with the platform admin escape hatch:

```sql
CREATE POLICY "read_companies" ON companies FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);

-- Write policies are usually stricter — see sprint 03 for the convention.
-- Reads: org members OR platform admin.
-- Writes: org members only, unless the action is explicitly "platform-only"
-- (e.g. impersonation log, support note on a foreign org).
```

**Why this pattern over alternatives:**

- *Consistency with `user_organization_ids()`* — same shape (SQL `STABLE SECURITY DEFINER` function), same review pattern in every policy. One mental model for the whole RLS layer.
- *Auditable* — `SELECT * FROM platform_admins` answers "who can see everything?" in one query. Compare to JWT custom claims, which require inspecting tokens or wiring an Auth hook.
- *Instantly revocable* — `DELETE FROM platform_admins WHERE user_id = ...`. No JWT to expire, no cache to invalidate.
- *No client-side change* — platform admins log in with the same `@supabase/ssr` flow as anyone else. Their elevated rights come from the DB, not the session payload.

**Discipline rules around platform admin:**

1. **Default-deny on writes.** A platform admin can *read* across all orgs, but cannot *write* to an arbitrary org by default. Each table's write policy must explicitly call `is_platform_admin()` only where cross-org writes are genuinely needed (e.g. a `support_notes` table where hitempo staff annotates a customer org). Most business tables should only allow writes from real org members.
2. **Audit every cross-org read.** Sprint 03 will add a trigger that logs `(user_id, table, row_id, timestamp)` to `platform_admin_audit` whenever a platform admin reads or writes outside their own orgs. Non-negotiable for SOC2 later.
3. **No platform admin in `organization_members`.** A platform admin is *not* a member of any org by virtue of being a platform admin. If they need to test as a member of L&G for debugging, they add themselves to L&G's `organization_members` explicitly (and remove themselves after) — that's tracked separately and stays consistent with the org-member contract.
4. **Promote via SQL, not via UI (MVP).** No "make admin" button anywhere. The `INSERT INTO platform_admins` runs from a migration or a manual SQL command. At V1+ we'll build a real admin UI on a separate subdomain.

**Complementary mechanism: `service_role`.** Supabase's `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. We use it for:

- Inngest workers and scheduled jobs (`getAdminDb()` in `db/client.ts`)
- Database migrations and the local seed script
- Webhooks where there is no authenticated user

We **never** use `service_role` in code that runs on behalf of a logged-in user — RLS + `is_platform_admin()` is the right tool for that. Service role is for trustworthy server contexts only.

**Future evolution (V1+).** A dedicated backoffice on `admin.hitempo.io` with its own login, mandatory 2FA, and a strict allowlist of IPs/SSO. The current `is_platform_admin()` table becomes that backoffice's user store. Until then, platform admins log in to the main app and get elevated rights via the helper function.

**Canonical RLS recipe for new tables.** See [`docs/conventions/rls.md`](conventions/rls.md). Every business table from sprint 04+ follows it verbatim — four SQL statements per table. Deviations require a comment in the migration.

## Authentication flow

### MVP

- Supabase Auth with email/password + Google OAuth providers
- Sign-up is **closed at MVP** (invite-only via `organization_members` admin action)
- Session managed by Supabase via cookies; Next.js middleware reads the session
- Protected routes under `app/(app)/` redirect to `/login` if no session

### V1+ additions

- Public signup with organization creation wizard
- Email magic links
- 2FA optional
- Org invitations via email

### Middleware

```typescript
// middleware.ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

Use the official Supabase Next.js helpers (`@supabase/ssr`) for cookie-based sessions.

## Data layer (Drizzle)

### Where the schema lives

`db/schema.ts` is the single source of truth. All tables, columns, relations, indexes defined here. Run `drizzle-kit generate` to produce migrations under `db/migrations/`.

### Query helpers

`db/queries/` contains typed query helpers organized by entity. Each helper takes the current org context as input.

```typescript
// db/queries/companies.ts
export async function getCompaniesByOrg(orgId: string, filters?: { ... }) {
  return db.query.companies.findMany({
    where: and(
      eq(schema.companies.organizationId, orgId),
      filters?.segmentId ? eq(schema.companies.segmentId, filters.segmentId) : undefined,
      filters?.scoreMin ? gte(schema.companies.score, filters.scoreMin) : undefined,
    ),
    with: { sites: true, contacts: true },
  });
}
```

### Connection

Two clients:

- **App client** (anon key + user session): used by Server Components, Server Actions. RLS applies.
- **Service client** (service role key): used by Inngest workers, migrations. RLS bypassed. Server-only, never exposed.

```typescript
// db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// App client (RLS active)
export const db = drizzle(postgres(env.SUPABASE_POSTGRES_URL));

// Admin client (RLS bypassed, server-only)
export const adminDb = drizzle(postgres(env.SUPABASE_POSTGRES_DIRECT_URL));
```

## AI integration

### Models

- **Anthropic Claude** (primary): rédaction française, contextual quality, long context
- **OpenAI**: scraping/structuration tasks, fallback
- **Mistral**: cost-optimized for high-volume tasks

### Brand brief contextualization

Each organization has a `brand_brief` JSON object with per-locale text:

```json
{
  "fr": "Léon & George parle avec élégance, sans survendre. Privilégie la précision plutôt que les superlatifs...",
  "en": "Léon & George speaks with elegance, never overselling. Prefers precision over superlatives..."
}
```

When generating an AI message, the brand brief is injected into the system prompt for the contact's `preferred_language`.

### Prompt builder pattern

```typescript
// lib/ai/prompts/message.ts
export function buildMessagePrompt(input: {
  contact: Contact,
  company: Company,
  signal?: Signal,
  template: MessageTemplate,
  org: Organization,
  locale: Locale,
}) {
  const brandBrief = input.org.brandBrief[input.locale];
  return {
    system: `You are writing on behalf of ${input.org.name}. ${brandBrief}`,
    user: `Generate a ${input.template.type} message in ${input.locale}...`,
  };
}
```

### Cost tracking

Every AI call logs to `ai_usage` table: `org_id`, `feature`, `model`, `input_tokens`, `output_tokens`, `cost_cents`. For billing/quotas later.

## Background jobs (Inngest)

### When to use Inngest

- Anything scheduled (daily digest, sequence advancement, periodic data refresh)
- Anything with retries (AI calls that may fail, external API calls)
- Anything async that doesn't need to block the user (CSV import, bulk enrichment)

### Pattern

```typescript
// inngest/functions/morning-digest.ts
import { inngest } from "../client";

export const morningDigest = inngest.createFunction(
  { id: "morning-digest" },
  { cron: "0 8 * * *" }, // every day at 8am
  async ({ event, step }) => {
    const users = await step.run("fetch-users", () => getAllUsers());
    for (const user of users) {
      await step.run(`digest-${user.id}`, () => sendMorningDigest(user));
    }
  }
);
```

### Sequence runner (V1)

The sequence runner is a polling job that wakes up every few minutes, finds `sequence_runs` whose next step is due, evaluates conditions, advances state. See `docs/data-model.md` for the schema.

## Email sending strategy

### MVP

- **Transactional (Resend)**: morning digest, "your message is generated" notifications, password resets. Templates in `lib/email/templates/` using React Email.
- **Outbound (Gmail OAuth)**: when a commercial sends a generated message to a prospect, it's sent from their personal Gmail via OAuth. Zero deliverability concerns. Quota: 500/day per Gmail account, more than enough.

### V1+

- Add Smartlead/Instantly/Lemlist API integration for automated sequences. Decision pending.
- Multi-domain warmed-up infrastructure.

## i18n strategy

### Architecture

`next-intl` with:
- Messages files in `messages/<locale>.json`
- No URL prefix on dashboard routes (language follows `user.preferred_locale`)
- Marketing pages (later) will use `/fr` and `/en` prefix

### Data localization

Several entities carry locale:

- `users.preferred_locale` (en | fr | ...)
- `contacts.preferred_language` (en | fr | ...)
- `companies.primary_locale` (en | fr | ...)
- `organizations.default_locale` + `organizations.supported_locales[]`
- `organizations.brand_brief` (JSON object per locale)
- `message_templates.locale` (a template = 1 entry per locale, linked via `template_group_id`)
- `messages` (sent) carries the locale used at send time

### Rules

- Never hardcode text in UI. Use `useTranslations()` / `getTranslations()`.
- Format dates/numbers with `Intl.DateTimeFormat` / `Intl.NumberFormat` based on user locale.
- AI prompts receive the locale and respond in that locale.

## Time and timezone

- All timestamps stored in UTC (Postgres `timestamptz`).
- Display in user's timezone (`users.timezone`).
- Scheduled email sends respect user timezone (Inngest passes the user's TZ to the job).

## Multi-currency

`opportunities.amount_cents` (integer) + `opportunities.currency` (ISO 4217 code: EUR, USD, GBP, etc.). Convert on display via `Intl.NumberFormat` with the currency code.

## Error handling

- Server actions return `{ ok: true, data } | { ok: false, error }` discriminated unions, never throw to the client.
- Errors logged to Sentry with context (orgId, userId, action, input).
- User-facing error messages are localized.

## Performance

- Server Components everywhere possible (smaller client bundle).
- Drizzle queries use proper indexes (defined in `schema.ts`).
- Heavy lists paginated (use cursor-based pagination on `created_at` desc).
- Realtime via Supabase Realtime for live updates (new tasks, mention, etc.) — V1+.

## Security checklist

- [ ] RLS policies on every business table
- [ ] All Server Actions validate inputs with Zod
- [ ] Service role key only in trusted server contexts (Inngest, migrations)
- [ ] CSRF protection via Next.js Server Actions (built-in)
- [ ] CORS configured for API routes if any
- [ ] Sentry DSN in env, not committed
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] User-uploaded files (CSV import, logos later) scanned for size + type
- [ ] AI prompts don't include sensitive PII from other orgs (RLS handles this if queries are correct)
- [ ] Rate limiting on AI generation endpoints (per org, per user)

## Code conventions

### Naming

- TypeScript types: `PascalCase`
- Variables, functions: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- DB columns: `snake_case` (Drizzle converts in schema definition)
- Routes: `kebab-case`

### Imports

Use path aliases:

```typescript
import { db } from "@/db/client";
import { Companies } from "@/db/schema";
import { getCurrentOrg } from "@/lib/auth/context";
```

### React

- Components in PascalCase, files in PascalCase.tsx
- Hooks in camelCase starting with `use`
- Server Components by default; mark `"use client"` only when needed (interactivity, hooks)
- Co-locate small components inside their feature folder, extract to `components/` when reused

### Comments

- No comments restating what the code does ("// increment counter")
- Comments explain *why*, never *what*
- Document complex algorithms or business rules

### Git commits

- Conventional commits: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`
- One feature = one PR. Keep them small (< 500 lines).
- Always link to the feature brief in the PR description.

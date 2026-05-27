# Sprint 02 — Auth & dashboard skeleton

Wire Supabase Auth into hitempo, gate the dashboard area behind a login, and ship the empty navigation shell that future sprints will fill in. By the end: Matt Thévenoz (the first L&G commercial) signs in at `/login`, lands on a sidebar-flanked dashboard, can log out, and can't reach any `(app)/*` route without a session.

## Why this matters

Sprint 01 gave us the foundations but no user identity. Every query so far has been either anonymous (the public home page) or via `service_role` (the seed script). Sprint 02 introduces the **per-request authenticated context** that the rest of the MVP depends on: `auth.uid()` becomes meaningful, `getCurrentOrg()` becomes possible, and sprint 03's RLS policies have something to enforce against.

We deliberately keep this sprint **narrow on auth methods** (email/password only) and **wide on infrastructure** (middleware, server clients, browser clients, sidebar layout, route protection). The expensive plumbing — `@supabase/ssr` cookie wiring, login server actions, the `getCurrentUser()` / `getCurrentOrg()` helpers — gets built once here and reused everywhere. Google OAuth waits for the Vercel deploy (it needs a stable redirect URI).

## Goals

1. `@supabase/ssr` browser + server clients wired idiomatically (no `service_role` leakage)
2. Cookie-based session refresh in Next.js middleware
3. `/login` page with email/password sign-in via a Server Action
4. Sign-up explicitly disabled at MVP (invite-only — `enable_signup = false` in `supabase/config.toml`, no `/signup` route)
5. Password reset flow (send email → set new password) — runs through Mailpit locally
6. `(app)/*` routes protected by middleware; unauthenticated requests redirect to `/login`; authenticated users hitting `/login` redirect to `/dashboard`
7. Sidebar layout under `(app)/` with nav links: Dashboard, Companies, Contacts, Tasks, Settings — each pointing to a placeholder page that says "Coming in sprint NN"
8. Logout Server Action that invalidates the session and redirects to `/login`
9. `lib/auth/context.ts` exposing `getCurrentUser()` (throws if no session) and `getCurrentOrg()` (throws if no membership) — used by every Server Component in `(app)/`
10. Matt Thévenoz created end-to-end via a reproducible script: user in `auth.users` + row in `organization_members` linking him to L&G as `commercial`
11. The dashboard page displays the logged-in user's email and their org name (proof the auth → org context wiring works)
12. `npm run lint`, `npm run build`, `npm run dev` all clean

## Prerequisites

- Sprint 01 complete (Next.js + Supabase local stack + Drizzle + L&G seeded)
- `supabase start` running locally (or willing to run it)
- `@supabase/ssr` and `@supabase/supabase-js` already installed (done in sprint 01 step 7)
- A fresh `npm run db:reset && npm run db:seed` if your local DB has drifted

## What this sprint deliberately does NOT do

- **Google OAuth**: needs a fixed redirect URI → wait for Vercel deploy. We design clients to make it a one-config-change addition later.
- **Multi-org switching**: at MVP a user belongs to exactly one org. Switcher comes V1+.
- **Public signup**: closed at MVP. Users are created via the admin script (see step 9).
- **2FA, magic links, social providers beyond Google**: out of scope.
- **RLS policies on business tables**: that's sprint 03. The auth layer lands here, the enforcement layer next.
- **Real UI for the dashboard / companies / contacts pages**: pure placeholders here. The data pages come sprint 04+.

## Implementation plan

### Step 1 — Disable signup in local Supabase config

Open `supabase/config.toml` and set **only** the top-level flag:

```toml
[auth]
enable_signup = false
```

Leave the email provider's own flag at `true`:

```toml
[auth.email]
# Do NOT set this to false. Despite the wording ("Allow/disallow new user
# signups via email"), this flag actually toggles the entire email provider
# on/off — flipping it breaks signin too. Use the top-level [auth] flag above
# to block signups, and keep this one true so signin keeps working.
enable_signup = true
```

Restart the stack so the change takes effect:

```bash
supabase stop
supabase start
```

After restart, verify signin still works against the Auth API directly (before pointing the app at it):

```bash
curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $(supabase status -o json | jq -r .ANON_KEY)" \
  -H "Content-Type: application/json" \
  -d '{"email":"<a real user>","password":"<the password>"}'
```

You should see a JSON access token. If you see `{"error_code":"email_provider_disabled"}`, you flipped the wrong flag — see implementation notes.

### Step 2 — Three Supabase clients (server, browser, middleware)

`@supabase/ssr` mandates three different client factories. Each runs in a different context and reads/writes cookies differently. Co-locate them under `lib/supabase/`.

`lib/supabase/server.ts` — Server Components, Server Actions, Route Handlers:

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `set` method was called from a Server Component.
            // Ignore — middleware refreshes the session.
          }
        },
      },
    },
  );
}
```

`lib/supabase/client.ts` — Client Components only:

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`lib/supabase/middleware.ts` — runs in Next.js Edge middleware to refresh sessions:

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    },
  );

  // IMPORTANT: call getUser() — it triggers the refresh-and-set-cookie cycle.
  // Do NOT remove this even if you don't use the user variable.
  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/auth");
  const isAppRoute = pathname.startsWith("/dashboard")
    || pathname.startsWith("/companies")
    || pathname.startsWith("/contacts")
    || pathname.startsWith("/tasks")
    || pathname.startsWith("/settings");

  if (!user && isAppRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}
```

### Step 3 — Wire the middleware

Create `middleware.ts` at the repo root (Next.js convention):

```typescript
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except Next internals, static assets, favicons.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

### Step 4 — Auth context helper

`lib/auth/context.ts`:

```typescript
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/client";
import { organizationMembers, organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

export async function getCurrentOrg() {
  const user = await getCurrentUser();
  const db = getDb();

  const membership = await db.query.organizationMembers.findFirst({
    where: eq(organizationMembers.userId, user.id),
    with: { organization: true },
  });

  if (!membership) {
    // User exists in auth.users but isn't a member of any org.
    // Shouldn't happen for normal users — invite flow always creates membership.
    throw new Error(`User ${user.id} has no organization membership`);
  }

  return { user, membership, organization: membership.organization };
}
```

You'll need to wire the Drizzle relations for the `with: { organization: true }` part. Add to `db/schema.ts`:

```typescript
import { relations } from "drizzle-orm";

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
}));
```

(Drizzle requires explicit relations metadata for `findFirst({ with })`. This is the first place we hit it; we'll add relations for new tables as they appear.)

### Step 5 — Login page + Server Action

`app/(auth)/login/page.tsx`:

```typescript
import { signInAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("auth");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signInAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-red-600">{t(`login.errors.${error}`)}</p>}
            <Button type="submit">{t("login.submit")}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

`lib/auth/actions.ts`:

```typescript
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signInAction(formData: FormData) {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid_input");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    redirect("/login?error=invalid_credentials");
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

Add translation keys to `messages/en.json` and `messages/fr.json`:

```json
{
  "common": { "appName": "hitempo", "tagline": "..." },
  "auth": {
    "login": {
      "title": "Sign in to hitempo",
      "email": "Email",
      "password": "Password",
      "submit": "Sign in",
      "errors": {
        "invalid_input": "Please check your email and password.",
        "invalid_credentials": "Wrong email or password."
      }
    }
  },
  "nav": {
    "dashboard": "Dashboard",
    "companies": "Companies",
    "contacts": "Contacts",
    "tasks": "Tasks",
    "settings": "Settings",
    "signOut": "Sign out"
  }
}
```

(French variants in `messages/fr.json` — translated below in step 6 alongside the nav.)

### Step 6 — Sidebar layout for `(app)/`

`app/(app)/layout.tsx`:

```typescript
import Link from "next/link";
import { getCurrentOrg } from "@/lib/auth/context";
import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, organization } = await getCurrentOrg();
  const t = await getTranslations("nav");

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r bg-slate-50 p-4 flex flex-col">
        <div className="text-2xl font-serif font-bold mb-6">hitempo</div>
        <nav className="flex flex-col gap-1 flex-1">
          <Link href="/dashboard" className="px-3 py-2 rounded hover:bg-slate-200">{t("dashboard")}</Link>
          <Link href="/companies" className="px-3 py-2 rounded hover:bg-slate-200">{t("companies")}</Link>
          <Link href="/contacts" className="px-3 py-2 rounded hover:bg-slate-200">{t("contacts")}</Link>
          <Link href="/tasks" className="px-3 py-2 rounded hover:bg-slate-200">{t("tasks")}</Link>
          <Link href="/settings" className="px-3 py-2 rounded hover:bg-slate-200">{t("settings")}</Link>
        </nav>
        <div className="border-t pt-4 mt-4 text-sm">
          <div className="font-medium text-slate-900">{user.email}</div>
          <div className="text-slate-600">{organization.name}</div>
          <form action={signOutAction} className="mt-3">
            <Button type="submit" variant="ghost" size="sm" className="w-full">
              {t("signOut")}
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

### Step 7 — Placeholder pages

Create five placeholders, each with the same minimal pattern. Example `app/(app)/dashboard/page.tsx`:

```typescript
import { getCurrentOrg } from "@/lib/auth/context";
import { getTranslations } from "next-intl/server";

export default async function DashboardPage() {
  const { user, organization } = await getCurrentOrg();
  const t = await getTranslations("nav");

  return (
    <div>
      <h1 className="text-3xl font-serif font-bold mb-4">{t("dashboard")}</h1>
      <p className="text-slate-600">
        Welcome {user.email} — you're acting on behalf of <strong>{organization.name}</strong>.
      </p>
      <p className="text-slate-500 mt-2 text-sm">Real dashboard content lands in sprint 06.</p>
    </div>
  );
}
```

Repeat for `app/(app)/companies/page.tsx`, `contacts/page.tsx`, `tasks/page.tsx`, `settings/page.tsx`. Each says "Coming in sprint 04 / 05 / 05 / later". Only `dashboard` needs the user/org display — the others can be one-line stubs.

### Step 8 — Password reset (Supabase handles it; we just provide entry points)

Two small additions:

- `app/(auth)/forgot-password/page.tsx` — form with email, calls `requestPasswordResetAction` which invokes `supabase.auth.resetPasswordForEmail(email, { redirectTo: '<NEXT_PUBLIC_SITE_URL>/auth/callback?next=/auth/reset-password' })`
- `app/(auth)/reset-password/page.tsx` — form with new password, calls `updatePasswordAction` which invokes `supabase.auth.updateUser({ password })`
- `app/auth/callback/route.ts` — Route Handler that calls `supabase.auth.exchangeCodeForSession(code)` then redirects to `next` query param

Locally, the reset email lands in Mailpit at `http://127.0.0.1:54324`. Open the email, click the link, set a new password, log back in.

Add a `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to `.env.local` (and `.env.example`). The cloud value will be the Vercel URL once we deploy.

### Step 9 — Create Matt Thévenoz (reproducible script)

Don't rely on Supabase Studio (it's not always running locally). Write a TS script that uses the Supabase admin API.

`db/create-user.ts`:

```typescript
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import { getAdminDb } from "./client";
import { organizations, organizationMembers } from "./schema";
import { eq } from "drizzle-orm";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
  const [email, password, orgSlug, role = "commercial"] = process.argv.slice(2);
  if (!email || !password || !orgSlug) {
    console.error("Usage: tsx db/create-user.ts <email> <password> <org-slug> [role]");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });
  const db = getAdminDb();

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, orgSlug),
  });
  if (!org) throw new Error(`No org with slug "${orgSlug}". Run npm run db:seed first.`);

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip email confirmation locally
  });
  if (error) throw error;

  const userId = data.user.id;
  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId,
    role: role as "owner" | "admin" | "commercial" | "viewer",
    preferredLocale: "fr",
    timezone: "Europe/Paris",
  });

  console.log(`Created ${email} (${userId}) as ${role} of ${org.name}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add to `package.json` scripts:

```json
"db:create-user": "tsx db/create-user.ts"
```

Then create Matt:

```bash
npm run db:create-user -- matt@leon-george.com "TempPassw0rd!" leon-george owner
```

(Choose any password — local only, you'll reset it. `owner` role so he can later manage members in sprint 03+ if we wire role checks.)

### Step 10 — End-to-end smoke test

With local stack and dev server running:

1. Open `http://localhost:3000/dashboard` → middleware redirects to `/login` ✓
2. Submit empty form → error message displays ✓
3. Submit wrong password → "Wrong email or password" displays ✓
4. Submit `matt@leon-george.com` / your password → redirected to `/dashboard` showing his email and "Léon & George" ✓
5. Click each sidebar link → placeholder page renders, sidebar stays ✓
6. Click "Sign out" → back at `/login` ✓
7. Try `http://localhost:3000/login` while authenticated → middleware redirects you to `/dashboard` ✓
8. Open another browser / incognito → not signed in there ✓

For the password reset:

1. Click "Forgot password?" link on `/login`
2. Enter Matt's email, submit
3. Open Mailpit (`http://127.0.0.1:54324`), click the reset link in the email
4. Set new password
5. Sign in with the new password — works ✓

### Step 11 — Verify `auth.uid()` works from the app context

This validates that the cookies are flowing correctly and that future RLS policies (sprint 03) will see the right user.

In `app/(app)/dashboard/page.tsx`, temporarily add (and remove before commit):

```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
const { data: probe } = await supabase.from("organization_members").select("user_id, role, organization_id");
console.log("auth.uid() sees:", user?.id, "rows visible:", probe);
```

You should see exactly Matt's membership row (because the sprint 01 policy `"users_read_own_memberships"` allows `user_id = auth.uid()` reads). If you see all memberships or none, RLS isn't being applied — check that you're using the server client (anon key + cookies), not the admin one.

Remove the probe before committing.

### Step 12 — Commit & document

Suggested commit message (do NOT auto-commit):

```
feat: sprint 02 auth & dashboard skeleton

- @supabase/ssr server/browser/middleware clients under lib/supabase/
- Cookie-based session refresh in Next.js middleware, route protection for (app)/*
- Login page + Server Action with Zod-validated email/password
- Sign-up disabled in supabase/config.toml (invite-only at MVP)
- Password reset via Mailpit (local) / Resend (later)
- Sidebar layout for (app)/, placeholder pages for dashboard/companies/contacts/tasks/settings
- lib/auth/context.ts: getCurrentUser() / getCurrentOrg()
- db/create-user.ts: reproducible script for inviting users into an org
- Drizzle relations on organizations <-> organization_members
- Matt Thévenoz created locally as owner of L&G
```

## Acceptance criteria

- [ ] Unauthenticated request to `/dashboard` redirects to `/login`
- [ ] Authenticated request to `/login` redirects to `/dashboard`
- [ ] Login form: empty submit shows error, wrong creds show error, right creds redirect to `/dashboard`
- [ ] Dashboard displays the logged-in user's email and the L&G org name
- [ ] Sidebar nav links all render their placeholder page within the same layout (sidebar persists)
- [ ] Sign out clears the session and redirects to `/login`
- [ ] Password reset email arrives in Mailpit, link works, new password logs in successfully
- [ ] `npm run db:create-user -- ...` creates a user in `auth.users` AND a row in `organization_members` linking to L&G
- [ ] `npm run lint`, `npm run build`, `npm run dev` all pass with zero warnings
- [ ] `noUncheckedIndexedAccess: true` doesn't flag any new code
- [ ] The probe in step 11 confirms `auth.uid()` returns Matt's user id and that the existing sprint-01 policy `users_read_own_memberships` is actually filtering

## Things to verify before declaring done

- **Defense in depth**: no Server Component in `(app)/*` should reach the DB without going through `getCurrentOrg()` first. Even before sprint 03 lands the full RLS policies, the helper enforces "the user is authenticated and has a membership" at the application layer.
- **No `service_role` in the request path**. The only places that may use `getAdminDb()` are: `db/seed.ts`, `db/create-user.ts`, and (future) Inngest workers. Greppable: a Server Action calling `getAdminDb()` should be a code review red flag.
- **i18n compliance**: every visible string in `/login`, the sidebar, and the placeholder pages comes from `messages/*.json`. No hardcoded English.
- **Server Action input validation**: every Server Action goes through a Zod schema. Server Actions are public endpoints.

## Implementation notes

Executed on 2026-05-26 on Ludovic's macOS, Node 24.16.0, Next.js 16.2.6 (Turbopack).

**Gotchas and deviations**

- **Server Actions can't be tested via `curl -X POST`.** Next.js Server Actions use an internal protocol with an encrypted `Next-Action` header that's only generated by the client bundle. A direct curl POST to `/login` returns `Failed to find Server Action`. Not a bug — Server Actions are designed to only be invoked from the React tree they were defined in. The e2e smoke test is therefore browser-only (acceptance criteria below).
- **`enable_signup` is a trap in `[auth.email]`.** I initially flipped *both* `[auth] enable_signup` (line 171) AND `[auth.email] enable_signup` (line 216) to `false`. Result: signin broke entirely (`{"error_code":"email_provider_disabled","msg":"Email logins are disabled"}`). The flag inside `[auth.email]` actually toggles the **entire email provider** (signup AND signin) despite its wording. **Correct setting:** `[auth] enable_signup = false` (blocks new signups globally) + `[auth.email] enable_signup = true` (keeps the email provider's signin path open). The config file now carries an inline comment to prevent the same mistake on a future `supabase init` or template copy.
- **`supabase stop && supabase start` did not wipe the local DB.** Data lives in a Docker volume, not in the container filesystem. L&G was still seeded after the restart — confirmed by `psql`. Good to know for future config changes.
- **`db/.drizzle-out/` has no new migration.** Sprint 02 doesn't touch the schema (no new tables; the Drizzle `relations(...)` declarations are TypeScript-only and don't produce SQL). When sprint 03 adds `platform_admins`, that's when we'll generate the next migration.

**Design decisions taken during implementation**

- **Cookie-driven locale (no URL prefix) stays simple in `(app)/`.** The dashboard layout reads `getCurrentOrg()` (which returns `membership.preferredLocale`) but does not push it into a route segment. We rely on the `locale` cookie set by next-intl. We may want to auto-set the locale cookie from `membership.preferredLocale` on first sign-in — punted to sprint 03 once we have a place to put that side effect.
- **Sign-out is a Server Action, not a Route Handler.** Lets us colocate it with `signInAction` and call it from a `<form>` in the sidebar. Side-effect: it cannot run on a hover or `prefetch` — only on the explicit form submit, which is the right semantics for sign-out.
- **`getCurrentOrg()` throws instead of returning a partial result.** A user without a membership is a data integrity bug, not a state we want to gracefully render around. Throwing makes the issue loud in development; production will see the Next.js error boundary.
- **`db/create-user.ts` uses the Supabase Admin API for the `auth.users` insert**, not raw SQL into `auth.users`. The Admin API hashes the password, sets `email_confirmed_at`, and emits the correct internal events. Raw SQL would bypass all of that and produce a user that can't log in.
- **Route prefixes (`/dashboard`, `/companies`, ...) are listed in the middleware as plain strings**, not regex. Easier to read, easier to extend, and Next.js doesn't lose performance because the matcher itself already filters out static assets.

**Verification done locally**

- `npm run lint` — 0 warnings, 0 errors (after removing an unused `headers` import)
- `npm run build` — succeeds, builds all 9 routes (`/`, `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/dashboard`, `/companies`, `/contacts`, `/tasks`, `/settings`) plus the middleware
- `curl -sI http://localhost:3000/dashboard` → `307 Location: /login` ✓ (middleware guard works)
- `curl -sI http://localhost:3000/companies` → `307 Location: /login` ✓
- `curl http://localhost:3000/login` renders the EN page (`Sign in to hitempo` / `Email` / `Password`) ✓
- `curl http://localhost:3000/forgot-password` renders ✓
- `npm run db:create-user -- matt@leon-george.com "TempPass123!" leon-george owner` → created user `29dc822a-9778-4a7a-bcda-8a2570d0ed87`, role `owner`, linked to L&G ✓
- The full browser-side flow (login → dashboard with user/org display → sidebar nav → sign-out → password reset via Mailpit) is for Ludovic to validate manually. See "Outstanding for Ludovic" below.

**Outstanding for Ludovic (browser smoke test)**

The Server Action flow needs a real browser to test. Steps:

1. Open `http://localhost:3000` → home page renders (still says "hitempo" + tagline).
2. Visit `http://localhost:3000/dashboard` → redirects to `/login`. ✓
3. On `/login`: try empty submit → error message. Try wrong password → "Wrong email or password". ✓
4. Log in with `matt@leon-george.com` / `TempPass123!` → land on `/dashboard` showing `matt@leon-george.com` and `Léon & George`. ✓
5. Click each sidebar link (Companies, Contacts, Tasks, Settings) → each placeholder renders, sidebar persists. ✓
6. Click "Sign out" → back at `/login`. Cookie cleared.
7. Visit `/login` while signed in (re-login, then hit `/login`) → redirects to `/dashboard`. ✓
8. Password reset: click "Forgot password?" on `/login` → enter email → submit → "If an account exists..." shown. Open Mailpit at `http://127.0.0.1:54324` → click the reset link in the email → set a new password → log in with the new one. ✓

**Probe to confirm `auth.uid()` works (for sprint 03 prep)**

Temporarily add to `app/(app)/dashboard/page.tsx` (then remove):

```typescript
const supabase = await createClient();
const { data: probe } = await supabase.from("organization_members").select("user_id, role, organization_id");
console.log("rows visible via RLS:", probe);
```

Expected: exactly one row — Matt's membership. If you see all memberships or none, `auth.uid()` isn't flowing into the DB session and sprint 03's policies won't work as designed.

**Follow-ups for sprint 03**

- Add `platform_admins` + `platform_admin_audit` tables (already designed in `data-model.md`).
- Add the full per-table read/write policy set following the convention in `data-model.md` → "RLS policies".
- Wire the integration test (`pgtap` or a Drizzle-based test) that proves user A in org X cannot see org Y's rows even when bypassing the app-layer filter.
- Decide whether sign-in should write `preferredLocale` into the `locale` cookie automatically (currently the user has to set it manually). Small UX win, small Server Action.
- The lazy `db` Proxy from sprint 01 was useful; consider tightening its typing now that we have `findFirst({ with })` patterns (current Proxy types may slightly lie about return shapes — TypeScript hasn't complained yet, but worth revisiting).
- Drop the `shadcn` package from `dependencies` (it was added during the sprint-01 init, not actually used at runtime).

## What's next

**Sprint 03 — Multi-tenancy & RLS.** Now that we have authenticated users, sprint 03 lays down the full RLS policy set across every business table (see `docs/architecture.md` → "Multi-tenancy" + "Platform admin pattern"). We'll add the `platform_admins` + `platform_admin_audit` tables, implement the `is_platform_admin()` helper, write the read/write policy convention for every existing table, and add integration tests that prove a user from org A literally cannot see org B's data even when bypassing the application filters. Sprint 02 hands sprint 03 a working `auth.uid()`; sprint 03 hands sprint 04 a secure data layer.

# hitempo — Project instructions for Claude Code

You are working on **hitempo**, a multi-tenant SaaS CRM and prospection platform for B2B SMB sales teams that combine digital outreach and field visits. First customer (dogfood) is **Léon & George**, a French premium plant company that prospects hotels, agencies and offices in Paris.

## Product wedge to remember

> AI contextualized by brand brief + fine-grained territory management (micro-zones, local signals, prescribers, field tours).

The "AI-native + field-aware" quadrant is structurally empty in Europe today. Every architectural choice should reinforce this wedge rather than dilute it.

## Stack (non-negotiable)

- **Framework**: Next.js 15 (App Router) + TypeScript strict
- **Hosting**: Vercel (git push deploy)
- **DB + Auth + Storage + Realtime**: Supabase (Postgres + Auth + RLS + Storage + Realtime)
- **ORM**: Drizzle (over Supabase Postgres)
- **Background jobs**: Inngest (delayed tasks, retries, scheduling)
- **Transactional email**: Resend (notifications only, NOT outbound)
- **Outbound email (MVP)**: Gmail OAuth of each user (deliverability 1-to-1)
- **AI**: Anthropic SDK (primary, FR rédaction) + OpenAI + Mistral (cost/scraping)
- **UI**: Tailwind + shadcn/ui (components copied into repo, not npm dependency)
- **Validation**: Zod (server actions, form inputs, API responses)
- **i18n**: next-intl — UI EN only at MVP but infrastructure ready ; data localized EN+FR from day 1
- **Monitoring**: Sentry + Vercel Analytics

V1+ additions (not yet in MVP): Twilio (SMS, V2), Google Calendar API (V1), Dropcontact (V1 enrichment), Smartlead/Instantly/Lemlist (V1 sequences).

## Core principles

1. **Multi-tenant from day 1.** Every business table carries `organization_id`. Supabase RLS policies enforce isolation at the Postgres level. A query without `WHERE organization_id` cannot leak data. This is non-negotiable.
2. **i18n from day 1.** Business data carries locale: `contact.preferred_language`, `message_template.locale`, `organization.brand_brief` as JSON-per-locale. UI uses next-intl with messages files. NO URL prefix on dashboard routes (language follows user preference).
3. **TypeScript strict.** No `any`. Prefer `unknown` + type guards if needed. Validate all inputs with Zod schemas. Type inference from Drizzle schemas where possible.
4. **Server Components first.** Use client components only when interactivity requires it. Server Actions for mutations.
5. **Drizzle is the source of truth** for schema. Always write/edit schema in `db/schema.ts`, then generate migrations via `drizzle-kit generate`. Don't write raw SQL migrations by hand.
6. **No emojis in code or strings** unless the user explicitly asks for them.
7. **Branding lowercase**: always `hitempo`, never `HiTempo` or `Hi Tempo`. Code-name; commercial naming may evolve at V2.

## Code style & patterns

Ludovic prefers strict object-oriented code wherever it adds clarity — services, infrastructure, integrations, anything with multiple implementations, lifecycle, or polymorphism. Apply consistently:

- **Real OOP, not duck-typed helpers.** When designing a service with multiple backends (LLM providers, payment gateways, storage adapters, etc.), use classes. Not loose functions, not "modules of helpers". If you'd write a folder of `*-helpers.ts`, ask first whether it's actually a Strategy/Service that deserves a class hierarchy.
- **SOLID principles** — Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion. Architectural decisions must be SOLID-justifiable.
- **Design patterns, applied deliberately:**
  - **Strategy** for swappable implementations of the same contract (LLM providers, scoring engines, message channels). Pure Strategy — no shared abstract base with Template Method unless the orchestration is genuinely identical and worth factoring.
  - **Builder** for constructing services with multiple params or built dependencies. Fluent API (`.withX()` returning `this`), validation in `getInstance()`. One Builder per Strategy.
  - **Provider + Factory of Provider** when extensibility matters (multiple instances coexist, per-tenant config, runtime switching). The Provider exposes `getStrategy()`; its Factory exposes `getInstance()`.
  - **Factory** (simpler variant) when only one instance is active at a time and selection is purely env-driven. `getInstance()` as canonical entry.
- **Constructor injection** for all dependencies. No `new` of collaborators inside a class — they're injected, mockable, testable.
- **Typed error hierarchies.** `abstract class XError extends Error` with concrete subclasses (`LlmEmptyResponseError`, `MissingEnvError`, etc.). Never `throw new Error("string")` in non-trivial code.
- **Immutable instances.** `readonly` fields, no setters after construction. Mutate via new instances, not in-place.
- **Pure functions are fine** for stateless logic (scoring formulas, parsers, prompt content assembly). The OOP requirement applies to services with state, lifecycle, or polymorphism.

Naming convention used in this project: a class that produces a thing exposes `getInstance()` as the canonical "give me the produced thing" method (Builders, Factories, Providers). Use `create()` only as a static entry point for chaining (`Builder.create().withX().getInstance()`).

## Hard rules

- **Always filter by `organization_id`** in every query. If you forget, RLS will save you, but defense in depth: explicit is better than implicit.
- **Never bypass RLS** with service role keys in user-facing code. Service role is only for trusted server-side jobs (Inngest workers, migrations).
- **Never use `dangerouslySetInnerHTML`** without a strong justification and sanitization.
- **Always validate Server Action inputs** with Zod. Server Actions are public endpoints — treat them as such.
- **No hardcoded text in UI components**. All text goes through `useTranslations()` / `getTranslations()` from next-intl. Even if we only ship EN at MVP.
- **Locale-aware date/number formatting**: use `Intl.DateTimeFormat` / `Intl.NumberFormat`, never manual formatting.

## Folder structure

The Next.js project lives at the repo root (Vercel convention). The Supabase CLI workspace lives under `supabase/`. Product docs under `docs/`. Local dev runs the full Supabase stack via Docker (`supabase start`); Vercel deploys the repo root.

```
hitempo/
├── CLAUDE.md
├── README.md
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── .env.example
├── .env.local                     # gitignored
├── docs/                          # product specs
│   ├── architecture.md
│   ├── data-model.md
│   └── features/
│       ├── README.md
│       ├── 01-foundations.md
│       └── 02-*.md ...
├── supabase/                      # Supabase CLI workspace (docker-compose under the hood)
│   ├── config.toml                # local stack config (ports, services)
│   ├── migrations/                # SQL migrations (generated by Drizzle, played by Supabase CLI)
│   └── seed.sql                   # optional SQL seed (Drizzle ts seed is preferred)
├── app/                           # Next.js App Router routes
│   ├── (auth)/                    # public auth pages (login, signup)
│   ├── (app)/                     # authenticated dashboard
│   │   ├── layout.tsx             # sidebar nav
│   │   ├── dashboard/
│   │   ├── companies/
│   │   ├── contacts/
│   │   ├── tasks/
│   │   └── ...
│   ├── api/                       # API routes (rare, prefer Server Actions)
│   ├── layout.tsx
│   └── page.tsx
├── components/                    # reusable UI
│   ├── ui/                        # shadcn primitives
│   └── app/                       # app-specific composites
├── db/                            # Drizzle layer
│   ├── schema.ts                  # source of truth for tables
│   ├── client.ts                  # Drizzle client setup
│   ├── queries/                   # typed query helpers
│   ├── sync-migrations.ts         # copies drizzle output into supabase/migrations/
│   └── seed.ts                    # TS seed runner (uses admin client)
├── lib/                           # pure business logic
│   ├── auth/                      # Supabase Auth wrappers
│   ├── ai/                        # Anthropic/OpenAI clients + prompt builders
│   ├── email/                     # Resend templates + Gmail OAuth
│   ├── scoring/                   # scoring formula + thresholds
│   └── i18n/                      # locale helpers
├── inngest/                       # background jobs
│   ├── client.ts
│   └── functions/
│       ├── morning-digest.ts
│       └── sequence-runner.ts     # V1
├── messages/                      # next-intl
│   ├── en.json
│   └── fr.json
├── i18n/
│   └── request.ts
└── public/
```

**Drizzle ↔ Supabase CLI flow.** Drizzle remains the source of truth for the schema (`db/schema.ts`). The generated SQL is committed to `supabase/migrations/` so the local stack and any environment Supabase CLI manages stays in sync (`supabase db reset`, `supabase db push`). See sprint 01 brief for the exact commands.

**Working directory.** All commands run from the repo root: `npm run *` (dev, build, db:*) and `supabase *` (start, db reset, link).

## Where to find what

- **Architecture detailed**: `docs/architecture.md` — multi-tenancy strategy, auth flow, AI integration, jobs, conventions
- **Data model + Drizzle schema spec**: `docs/data-model.md` — every table, column, relation, index, RLS policy
- **Feature roadmap**: `docs/features/README.md` — full list of features in implementation order, dependencies
- **Current feature being implemented**: the latest `docs/features/NN-feature.md` Ludovic has shared

## How we work

1. Ludovic provides one feature brief at a time (`docs/features/NN-name.md`).
2. Read the brief, then read `architecture.md` and `data-model.md` sections referenced.
3. Implement the feature. Write Drizzle schema changes first if needed, generate migration, then code.
4. Use shadcn/ui CLI (`npx shadcn-ui@latest add <component>`) when you need a new primitive.
5. Write tests for business logic (scoring, condition evaluation, AI prompt builders). UI can be tested via Playwright or by visual inspection.
6. Before declaring done: verify multi-tenant safety, i18n compliance (no hardcoded strings), Zod validation on all inputs, type safety (no `any`).
7. Update the feature brief with a `## Implementation notes` section at the bottom for the next dev (or future-you).

## Testing approach

- **Unit tests** (Vitest): pure business logic (scoring, parsers, prompt builders, locale formatters)
- **Integration tests** (Vitest + drizzle-kit): query helpers against a test DB branch
- **E2E** (Playwright, later): critical user flows (login → create company → generate AI message → mark task done)

Don't over-test the framework. Test the business logic.

## Communication style with Ludovic

- He prefers concise, direct answers with a recommendation.
- When proposing options, give 2-3 alternatives + a recommended one.
- If a decision is reversible, just make it and explain. Don't ask for permission on minor choices.
- Always speak French to Ludovic. Code, comments, and docs in English.
- Branding lowercase: hitempo (never HiTempo).

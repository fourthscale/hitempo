# Twenty vs hitempo — Analysis & Customization Strategy

> **Purpose of this document.** A self-contained research report comparing the open-source CRM
> [Twenty](https://github.com/twentyhq/twenty) with **hitempo**, and a strategy proposal for how far
> hitempo should let customers customize the CRM (custom fields, hidden/renamed fields, custom views).
> It is written to be **reused as input for a planning session** (e.g. Claude Cowork): study it,
> break it into feature briefs, and sequence the work. No prior conversation context is required.
>
> **Status:** research / strategy. Nothing here is implemented yet.
> **Audience:** future-you, or an AI agent asked to plan the customization layer.

---

## 0. TL;DR (read this first)

- Twenty is a generic, horizontal open-source CRM whose headline idea is a **runtime metadata-driven
  data model**: objects and fields are stored as *data*, and the GraphQL API is regenerated on the fly.
  Powerful, but pays a heavy price (custom ORM, schema-per-tenant, weak static typing, thin tests).
- hitempo's stack is the opposite philosophy: **Drizzle as typed source of truth**, Supabase RLS,
  Server Actions + Zod. That is a strength we should not throw away.
- **Recommended strategy:** keep business objects **in code** (typed, first-class), and add a
  **two-layer customization surface on top**:
  - **Layer 1 — Custom fields:** customers add extra fields on existing objects (JSONB + metadata table).
  - **Layer 2 — Presentation config:** customers hide / reorder / rename fields and configure list views
    (applies to *both* native and custom fields). No schema change.
- **Never customizable:** the objects and logic that carry our wedge — territory, micro-zones,
  prescribers, field tours, scoring, AI contextualization, RLS. These stay first-class and opinionated.
- **This is where we beat Twenty, not imitate it:** custom fields should *feed the AI context*
  (brand brief + org-specific attributes), not sit as dead data.
- **Licensing note:** Twenty is AGPL. Reading it for inspiration is fine; **do not copy its code** into
  hitempo (license contamination).

---

## 1. What Twenty is

- Open-source CRM (~49k GitHub stars), positioned as a Salesforce / Attio alternative.
- Full-TypeScript, Nx monorepo.
- Core philosophy: *"build, ship, and version your CRM like software"* — the data model is a **runtime**,
  not code. Admins create objects/fields in the UI; no redeploy needed.
- Editions: Cloud Pro $9/user/mo, Organization $19 (SSO + row-level permissions), self-hosted (Docker Compose).

### Twenty's tech stack

| Layer | Twenty |
|---|---|
| Frontend | React + Recoil/Jotai + Linaria (CSS-in-JS) + Lingui (i18n) |
| API | **GraphQL, generated dynamically at runtime** from metadata |
| Backend | NestJS + BullMQ |
| ORM | `twenty-orm` (in-house wrapper over TypeORM, workspace-aware) |
| Database | Postgres + Redis |
| AI | OpenAI/Anthropic + **native MCP server** (OAuth) for Claude/ChatGPT/Cursor |

---

## 2. Twenty's key architectural idea: metadata-driven data model

This is the most notable thing about Twenty, and the crux of the comparison.

- Objects/fields are **not hardcoded**. They live in metadata tables: `DataSource`, `ObjectMetadata`,
  `FieldMetadata`.
- Creating a custom object in the UI writes metadata → the backend **regenerates its full GraphQL schema
  (types, resolvers, filters, sorting) at runtime**. A `findMany` query appears on the API seconds later.
  No codegen, no redeploy.
- A `TypeMapperService` maps field types (TEXT, DATE_TIME, BOOLEAN, RELATION, SELECT, …) to GraphQL scalars.
- **Multi-tenancy:** **one Postgres schema per workspace** (`workspace_{uuid}`), with shared core metadata.
  DDL/migrations are gated behind consistency checks.

### Trade-offs (acknowledged by community reviews)

- **Heavy infra:** Postgres + Redis + NestJS required; no single-binary / sqlite fallback.
- **Custom ORM friction:** `twenty-orm` adds workspace-aware patterns with thin docs and a learning curve.
- **Weak static typing:** because the model is runtime, you lose compile-time guarantees.
- **Spotty tests** on the most critical paths (dynamic schema assembly, workspace migrations).

---

## 3. Twenty vs hitempo — head to head

| Dimension | Twenty | hitempo |
|---|---|---|
| Frontend | React + Recoil/Jotai + Linaria | Next.js 15 App Router + Tailwind/shadcn |
| API | GraphQL generated at runtime | Server Actions + Zod |
| Backend / jobs | NestJS + BullMQ | Inngest |
| ORM | `twenty-orm` (runtime, dynamic) | **Drizzle (typed, schema-as-code source of truth)** |
| Database | Postgres + Redis | Supabase (Postgres + RLS + Auth + Storage + Realtime) |
| Multi-tenancy | Schema-per-workspace | **RLS by `organization_id` on shared schema** |
| i18n | Lingui (UI) | next-intl (UI) + localized business data (EN+FR from day 1) |
| Data model | 100% runtime metadata | **Typed in code; customization as an opt-in layer** |
| AI | Chat + MCP server | Anthropic/OpenAI/Mistral; **AI contextualized by brand brief** |
| Positioning | Horizontal, generic CRM | **Vertical: AI-native + field-aware (territory/tours)** |

**Conclusion:** the architectures are opposites. **Twenty is not a codebase to copy** — its value to us
is conceptual (product patterns, UX, the MCP idea), not code. Our typed-core + RLS approach is simpler to
operate and is a genuine strength.

### What Twenty has that confirms our wedge by its *absence*

Twenty is a horizontal generalist. It has **no notion of** territory, micro-zones, prescribers, field
tours, or AI contextualized by a brand brief. That "AI-native + field-aware" quadrant — our wedge — is
structurally empty. Twenty's gap is our differentiation.

---

## 4. Twenty features worth studying (with relevance to hitempo)

| Twenty feature | What it does | Relevance to hitempo |
|---|---|---|
| **Custom fields** | Add fields to objects from Settings, no redeploy | **High** — see strategy below (Layer 1) |
| **Custom objects** | Create entirely new object types at runtime | **Medium/Later** — defer until a customer truly needs it |
| **Views** (table, kanban, saved filters/sorts, layouts) | Saved views with filters, custom columns, real-time | **High** — reference UX for our company/contact lists |
| **Presentation config** | Hide/reorder/rename fields, choose columns | **High** — see strategy below (Layer 2) |
| **Workflow engine** (no-code) | trigger → filter → action → branch; triggers: record create/update/delete, manual, scheduled, webhook; actions: CRUD, email, code, HTTP, dynamic forms | **High vocabulary** for our sequence editor (we already have flow diagrams + Inngest `sequence-runner`) |
| **Native AI chat + MCP server** | CRM exposed to Claude/ChatGPT via OAuth; AI acts in natural language | **High** — strongly aligned with our AI-native wedge; cheap to prototype |
| **Apps framework** | `npx create-twenty-app`, React components + server logic publishable per workspace | **Low/Later** — extensibility-by-code, premature for us |
| **CSV import** | 50k+ records | We already have CSV import (feature 09) |

---

## 5. Customization strategy for hitempo (the core recommendation)

**Principle:** *We own the skeleton and the logic; the customer owns the skin.*

Keep business objects in code (Drizzle, typed). Offer customization as **two distinct layers**, because
they are technically and conceptually different.

### Layer 1 — Custom fields (adding data)

The customer creates fields that don't exist in our model.
Examples for L&G / hospitality: hotel star rating, lobby surface (m²), décor style, last renovation year,
estimated plant budget.

- This is **~80% of the real "every org works differently" need**, and cheap on our stack.
- **Implementation sketch (fits Drizzle + Supabase, no runtime schema generation):**
  - A `custom_fields jsonb` column on core tables (`companies`, `contacts`, deals, …) — the *data*.
  - A `field_definition` metadata table — the *definition*:
    `organization_id`, `entity` (company/contact/…), `key`, `label_en`, `label_fr`, `type`
    (text/number/date/select/boolean/relation), `options` (for select), `required`, `position`.
  - Respects multi-tenancy (`organization_id` + RLS) and i18n (localized labels) by construction.
  - The UI reads `field_definition` and **renders fields dynamically**; the Zod schema is built on the fly
    from the definitions for validation.
  - Postgres **GIN index** on the JSONB for filter/sort; add an **expression index** per field if a field
    becomes "hot".
- **Result:** customers personalize without migrations or redeploys, **and the core stays typed.**
  ~80% of Twenty's value for ~5% of its complexity.

### Layer 2 — Presentation config (display, not data)

Does **not** touch data — only how it is presented. Applies to **both native and custom fields**.

- Hide a field (e.g. an org that never uses "SIRET").
- Reorder fields in the record detail.
- Rename a label ("Company" → "Establishment" for a hospitality client).
- Choose which columns appear in list views.

- **Implementation sketch:** a `field_layout` / `view_config` table keyed by `organization_id`
  (and ideally per-user for personal views). This is **presentation config, not schema.**

### What is NEVER customizable

- **Structure** of wedge objects: company, contact, deal, **territory, micro-zone, prescriber, field tour**.
- **Business logic**: scoring, AI contextualization, RLS, sequences.

These stay first-class and opinionated. If we let them become generic custom fields, we become a generic
Twenty and lose the wedge.

### Decision matrix

| | In code (Drizzle, typed) | Customer-configurable |
|---|---|---|
| Structure of business objects (company, contact, deal, **territory, prescriber, tour**) | yes | **never** |
| Extra fields on those objects | — | yes (Layer 1) |
| Visibility / order / label / columns | — | yes (Layer 2) |
| Business logic (scoring, AI, RLS, sequences) | yes | **never** |

### Custom objects (Layer 3) — explicitly deferred

Creating entirely new object types at runtime (Twenty's full metadata model) is the expensive 20%.
It is where Twenty pays the most (GraphQL runtime, custom ORM, schema-per-tenant). **Defer until a
customer genuinely requires a net-new object type.** Most SMB B2B needs are extra *fields* on existing
objects, not new objects. Revisit only on proven demand.

---

## 6. Where we beat Twenty instead of imitating it

Twenty has custom fields but treats them as **dead data**. hitempo can **inject custom fields into the AI
context**: brand brief + org-specific attributes → even more contextualized French copywriting.

Example: a custom field "décor style = minimalist Japanese" flows into the generated outreach message.
Twenty does not do this. **Custom fields become fuel for the AI-native wedge, not just an extra box.**

This should be an explicit requirement of the Layer 1 design: custom field values must be exposable to the
AI prompt builders (`lib/ai/`).

---

## 7. Open questions / decisions to make before building

1. **Scope of v1:** Layer 1 (custom fields) only, or Layer 1 + Layer 2 (presentation) together?
   (Recommendation: Layer 1 first; it unlocks the most value.)
2. **Field types for v1:** which subset? (Suggest: text, number, date, boolean, single-select. Defer
   multi-select, relation, formula.)
3. **Filtering/sorting on custom fields in list views:** in scope for v1 or later? (Affects index strategy.)
4. **Per-user vs per-org views** in Layer 2: ship org-level first, user-level later?
5. **AI integration depth:** auto-include all custom fields in prompts, or let the user mark which fields
   are "AI-relevant"?
6. **Permissions:** who in an org can define custom fields (admin only?) vs who can edit values?
7. **Migration/operational constraint:** remember the single cloud Supabase = prod; migrations must stay
   additive-only. JSONB approach is friendly here (no per-field DDL).
8. **CSV import interplay:** should import map into custom fields (feature 09 already exists)?

---

## 8. Suggested feature breakdown (starting point for planning)

Rough, to be refined into `docs/features/NN-*.md` briefs:

- **NN — Custom fields (Layer 1):** `field_definition` table + `custom_fields` JSONB on companies/contacts;
  dynamic form rendering; dynamic Zod validation; GIN index; admin UI to define fields. (i18n labels, RLS.)
- **NN — Custom fields in AI context:** expose custom field values to `lib/ai/` prompt builders; per-field
  "AI-relevant" flag.
- **NN — Presentation config (Layer 2):** `view_config` table; hide/reorder/rename native + custom fields;
  list column selection. Org-level first.
- **NN — Custom field filtering/sorting in views:** expression indexes for hot fields; filter UI.
- **(Later) Custom objects (Layer 3):** only on proven customer demand; re-evaluate architecture cost first.

---

## 9. Sources

- [github.com/twentyhq/twenty](https://github.com/twentyhq/twenty)
- [twenty.com](https://twenty.com)
- [Twenty docs — custom objects](https://docs.twenty.com/developers/backend-development/custom-objects)
- [Twenty docs — workflows](https://docs.twenty.com/user-guide/workflows/overview)
- [Repo review — codeline.co](https://www.codeline.co/thoughts/repo-review/2024/twenty-open-source-crm)
- [DeepWiki — twentyhq/twenty](https://deepwiki.com/twentyhq/twenty)

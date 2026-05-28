# Sprint 09 — CSV Import & Polish

## Goal

Make hitempo **dogfood-ready for Léon & George** by enabling bulk import of their existing prospect database (companies, contacts, sites) from CSV files. Without this, on-boarding L&G means manually creating ~200 hôtels Paris — non-starter.

Secondary goal : **lightweight org-scoped reference IDs** (`organisation_ref`) on every business entity, so users can keep their internal IDs (e.g. `ACME-001`) inside hitempo. This unlocks :

- **Multi-step imports** : import companies on Monday, contacts on Tuesday, link them via `company_organisation_ref`.
- **Future external integrations** : Hubspot / Pipedrive sync rides on the same column.
- **Re-imports** : update an existing row by re-importing with the same `organisation_ref`.

> Sprint 09 is the last *planned* MVP sprint. Whatever comes next is driven by L&G's first weeks of real use.

---

## Prerequisites

- Sprints 01–07 done ✅.
- L&G has a CSV export of their current prospect list (hôtels, contacts).
- Brand brief renseigné for L&G via `/settings/brand` (done in sprint 07).

---

## Scope

### In scope

1. **Schema migration : `organisation_ref` column**
   - Added to `companies`, `contacts`, `sites`.
   - `text NULL` (optional — null means "no external ref set").
   - Composite unique constraint per `(organization_id, organisation_ref)` *partial* — `WHERE organisation_ref IS NOT NULL`.
   - No prod data backfill (existing rows stay null).

2. **CSV import infrastructure** — class hierarchy following CLAUDE.md conventions :
   - `CsvImporter` interface — `import(rows, ctx): Promise<ImportResult>`.
   - `CompaniesCsvImporter`, `ContactsCsvImporter`, `SitesCsvImporter`, `AllInOneCsvImporter` (Strategy pattern).
   - `CsvImporterFactory` (selects strategy by mode).
   - `CsvImportService` Facade — owns the lifecycle : parse → validate → preview → commit.

3. **Four import modes** (user picks at upload time) :
   - **Companies only** — one row = one company.
   - **Contacts only** — one row = one contact ; the row carries a `company_organisation_ref` column to link the contact to an existing company.
   - **Sites only** — one row = one site ; same linking convention.
   - **All-in-one** — one row = one company (+ optionally one site + one contact). Useful for L&G's flat hotel-prospect spreadsheets.

4. **Linking strategy : `organisation_ref` is the only key** (no natural-key fallback)
   - If a CSV row carries an `organisation_ref` matching an existing row in this org → **update** that row.
   - If `organisation_ref` is empty OR doesn't match → **insert** a new row.
   - For contacts/sites, if `company_organisation_ref` doesn't resolve to an existing company → **error** for that row (or auto-create the company in all-in-one mode).
   - Deliberate trade-off : no natural-key fallback means clean predictable behavior. The user is responsible for setting `organisation_ref` if they want updates.

5. **Upload + preview flow** (single page `/settings/import`)
   - Drop zone — accepts `.csv`, `.tsv`.
   - Mode selector — companies / contacts / sites / all-in-one.
   - **Template download** — for each mode, a "Download template" link next to the mode selector. Route : `GET /api/import/template?mode=<mode>`. Generates the CSV on-the-fly from a shared `csv-template-headers.ts` constant (same one the importer uses), plus one bidon example row so the user sees the expected format. Single source of truth, no drift between template and importer.
   - Column mapping UI — auto-detects standard column names ; user can re-map if the CSV uses different headers.
   - Preview table — first 20 rows with per-cell validation (red on Zod error, amber on warning).
   - Commit button — confirmed via modal showing total counts (`X to create, Y to update, Z errors`).

6. **Server action `runCsvImportAction`**
   - Streamed (or chunked) commit so a 5000-row import doesn't time out the action.
   - Per-row Zod validation reuses the existing schemas from `lib/actions/{companies,contacts,sites}.ts`.
   - Errors per row collected and returned as a `ImportResult` (success count, error rows, warnings).
   - Multi-tenant : every insert/update carries `organization_id = activeOrganization.id`.

7. **`/settings/import` UI** — branded, accessible, i18n FR + EN.

8. **Scoring recompute** — companies created/updated trigger `recomputeCompanyScore` via the existing engine (fire-and-forget, same as the manual CRUD paths).

9. **Tests** :
   - `CsvImporter` strategies (parse + validate against mock data, per-mode).
   - `CsvImporterFactory` resolves correctly per mode.
   - Linking logic : matches by `organisation_ref`, inserts when absent.
   - All-in-one : creates company + contact + site atomically per row.

### Out of scope

- **Bulk delete** (V1 — for now users delete one-by-one in the UI).
- **Bulk update without import** (V1).
- **Export to CSV** (V1).
- **Scheduled / API-driven imports** (V1 + Inngest).
- **Smart deduplication** based on natural keys (deliberate — see linking strategy above).
- **Onboarding wizard** that drives the user through "first import" (post-MVP).
- **Excel `.xlsx`** native parsing (CSV/TSV only at MVP ; users export to CSV from Excel).
- **Interactions import** (V1 — interactions are operational, not historical bulk-imported).

---

## Data model changes

```ts
// db/schema.ts — add `organisationRef` column to 3 tables
companies: {
  // ... existing columns
  organisationRef: text("organisation_ref"),
}
contacts: {
  organisationRef: text("organisation_ref"),
}
sites: {
  organisationRef: text("organisation_ref"),
}
```

Composite partial unique index per table :

```sql
CREATE UNIQUE INDEX companies_org_ref_unique
  ON companies (organization_id, organisation_ref)
  WHERE organisation_ref IS NOT NULL;
-- same for contacts, sites
```

The `WHERE organisation_ref IS NOT NULL` is essential : null values must NOT collide with each other (most existing rows will be null).

---

## CSV format reference

The headers below are the canonical column names. The mapping UI lets users alias non-standard headers.

### Companies CSV
```
organisation_ref, name, legal_name, website_url, linkedin_url,
relationship_type, industry, size_estimate, standing,
primary_locale, signal_type, signal_source, notes, parent_organisation_ref
```

### Contacts CSV
```
organisation_ref, company_organisation_ref, first_name, last_name, job_title,
role, email, phone, linkedin_url, preferred_language, preferred_channel,
relevance, notes
```

### Sites CSV
```
organisation_ref, company_organisation_ref, name, type,
address_line_1, postal_code, city, region, country,
is_primary, standing, notes
```

### All-in-one CSV
Union of the columns above, one row = one tuple `(company, site?, contact?)`.

```
company_organisation_ref, company_name, company_website,
site_organisation_ref, site_name, site_city, site_country,
contact_organisation_ref, contact_first_name, contact_last_name, contact_email
```

The importer creates/updates the company first (by `company_organisation_ref`), then the site (linked to the company), then the contact.

---

## Architecture (class layout)

```
lib/imports/
├── csv-importer.ts                   # interface CsvImporter
├── csv-import-service.ts             # Facade : parse → validate → preview → commit
├── csv-import-service-factory.ts     # lazy singleton
├── csv-importer-factory.ts           # selects strategy by mode
├── csv-import-errors.ts              # typed UserFacingActionError subclasses
├── csv-row-validator.ts              # shared Zod helpers per entity
├── csv-template-headers.ts           # ONE source of truth for headers + 1 example row per mode
└── importers/
    ├── companies-csv-importer.ts
    ├── contacts-csv-importer.ts
    ├── sites-csv-importer.ts
    └── all-in-one-csv-importer.ts

app/api/import/template/route.ts      # GET /api/import/template?mode=<mode> → CSV download
```

Follows the canonical Strategy + Builder + Factory of Provider pattern (mirroring `lib/ai/`). `CsvImportService` is the Facade ; UI actions never instantiate strategies directly.

---

## Acceptance criteria

- [ ] `organisation_ref` column added to companies/contacts/sites with composite partial unique index per table.
- [ ] `/settings/import` page accessible, branded, i18n FR + EN.
- [ ] Drop zone accepts .csv / .tsv ; rejects other formats with a friendly error.
- [ ] All 4 import modes selectable and functional.
- [ ] Column mapping UI works for non-standard headers.
- [ ] Preview shows first 20 rows with per-cell validation feedback.
- [ ] Commit produces accurate counts (create / update / skip).
- [ ] Multi-tenant : a user can never reference or import into another org's `organisation_ref`. Verified by RLS + unique constraint.
- [ ] All-in-one mode atomically creates company + site + contact (transaction).
- [ ] A re-import with the same `organisation_ref` updates the existing row, does NOT duplicate.
- [ ] Error rows are reported with their line number and the Zod issue ; valid rows still commit.
- [ ] Tests : importer strategies, factory, linking logic, all-in-one happy path.
- [ ] `tsc` + `eslint` + `vitest` + `next build` all green.
- [ ] Template download works for each of the 4 modes ; downloaded file uses the exact same header set as the importer expects ; re-uploading the empty template (without filling it) reports "no valid rows" gracefully.
- [ ] Browser smoke test : upload one of L&G's real CSV exports and successfully ingest ≥ 100 rows.

---

## Implementation plan (high-level)

1. **Schema** (1h) — add `organisationRef` to 3 tables, generate Drizzle migration, partial unique index.
2. **Importer core** (3h) — `CsvImporter` interface, `CsvImportService` Facade, factory, typed errors.
3. **Strategies** (4h) — 4 importers, each with Zod schema reuse + Drizzle insert/update logic.
4. **CSV parsing + templates** (2h) — pick a lib (`papaparse` or `csv-parse`), wrap behind a single helper with streaming. Build the `csv-template-headers.ts` source-of-truth + `/api/import/template` route.
5. **UI** (4h) — `/settings/import` page, drop zone (existing shadcn ?), preview table, column mapping, commit modal.
6. **Server action** (2h) — `runCsvImportAction`, Zod-validated input, delegates to `CsvImportService`.
7. **i18n** (1h) — full FR + EN translation pass.
8. **Tests** (3h) — importer strategies, factory, linking, all-in-one tx.
9. **Browser smoke with L&G data** (1h) — final acceptance.

Estimated : ~21h of focused work.

---

## Resolved design decisions

- **Update granularity** : on re-import, **only fields present in the CSV are written**. Untouched columns keep their in-app values (scoring, signal, status, etc.). Missing columns ≠ "set to null".
- **Transaction boundary** : **per-row**. Each row is its own Drizzle transaction. A bad row reports an error and the import continues. Partial imports are more useful than all-or-nothing.
- **Parsing** : **streaming parser** (papaparse with `step` callback, or csv-parse in Transform mode). Emits rows one by one, constant memory footprint regardless of file size. Pairs naturally with per-row tx — each emitted row triggers one transaction. No explicit tmp file needed on Vercel ; the FormData Blob lives in memory but the parsed view is incremental.

---

## Implementation notes

### What shipped

All 4 import modes are live. The architecture follows the brief closely — Strategy + Facade + Factory as specified in `lib/imports/`.

### Deviations from spec

**Column mapping UI — not built.** Auto-detection of standard header names only. Users must either use the downloaded template (headers pre-filled) or rename their columns to match. The template download covers this use case well enough for L&G's data at MVP. Column mapping is a V1 item.

**Pre-commit preview table — replaced by dry-run results.** The spec described a "preview before commit" flow with per-cell Zod feedback. What shipped instead: a single action that runs in dry-run mode first, shows the result counts (would create X / would update Y / Z errors), then the user confirms and the real commit runs. Simpler to build, same safety guarantee.

**Streaming parser — papaparse `complete` callback, not `step`.** True row-by-row streaming (papaparse `step`) was evaluated but added complexity for marginal gain at L&G's file sizes (~200–2000 rows). `complete` loads the full CSV into memory once, then iterates rows. Fine for Vercel's memory limits at this scale.

### Additions beyond spec

**Filter tabs + pagination on results.** After a commit, results are shown with tabs: All / Errors / Created / Updated. Long result sets paginate with "Show 50 more" / "Show all" buttons. Reduces noise when importing 200 rows with a handful of errors.

**Download error report.** A "Download errors as CSV" button on the Errors tab lets users fix their source file outside hitempo and re-import. The downloaded CSV is the original input rows that errored, with an extra `error` column appended.

### Responsive design (Phase 1 + Phase 2)

Shipped as a follow-up after sprint 09, not in the original brief:

- **Phase 1 (Survive):** Drawer sidebar with hamburger (breakpoint `lg`/1024px — covers both mobile and tablet portrait), `overflow-x-auto` on all tables, viewport-safe dialog sizes, form grids stack on mobile, `PageHeader` responsive.
- **Phase 2 (Use):** Companies + contacts lists → cards on `<lg`, `GenerateMessageDialog` full-screen on mobile, `FormFooter` component (sticky bottom on `<lg`, inline on `lg+`) wired into all forms, dashboard + tasks headers stack on mobile, admin list pages cards on `<lg`.

### Known gaps / follow-ups

- **Browser smoke with L&G real data** — acceptance criterion not yet checked. Should be done on the production instance before declaring MVP closed.
- **`organisation_ref` visibility in UI** — the column exists in the DB but is not shown anywhere in the company/contact/site detail pages. Useful for import debugging. Low priority.
- **Bulk export to CSV** — deliberately out of scope, V1.

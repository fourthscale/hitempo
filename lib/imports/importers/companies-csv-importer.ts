import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { companies } from "@/db/schema";

import {
  type CsvImportContext,
  type CsvImporter,
  type CsvRow,
  type CsvRowOutcome,
} from "../csv-importer";

/**
 * Importer for the **companies** CSV mode.
 *
 * Each row → one company. The strategy :
 *   1. Validates the row against the Zod schema below (returns `error`
 *      outcome on bad shape).
 *   2. If `organisation_ref` is set and matches an existing company in
 *      this tenant → `UPDATE` only the columns present in the row
 *      (present-fields semantics, see sprint 09 brief).
 *   3. Otherwise → `INSERT` a new company.
 *   4. If a `parent_organisation_ref` is set and resolves → set
 *      `parentId` ; if unresolved → soft error (warning), the row still
 *      commits with `parentId = null`.
 *
 * Multi-tenant : every query filters by `organizationId` from `ctx`.
 */

const RELATIONSHIP_VALUES = [
  "prospect", "client", "former_client", "prescriber", "partner",
] as const;

const LOCALE_VALUES = ["fr", "en"] as const;

const rowSchema = z.object({
  organisation_ref: nullableString(80),
  name: z.string().trim().min(1).max(200),
  legal_name: nullableString(200),
  website_url: nullableUrl(),
  linkedin_url: nullableUrl(),
  relationship_type: nullableEnum(RELATIONSHIP_VALUES),
  industry: nullableString(100),
  size_estimate: nullableString(50),
  standing: nullableInt(1, 5),
  primary_locale: nullableEnum(LOCALE_VALUES),
  signal_type: nullableString(100),
  signal_source: nullableString(200),
  notes: nullableString(5_000),
  parent_organisation_ref: nullableString(80),
});

type ParsedRow = z.infer<typeof rowSchema>;

export class CompaniesCsvImporter implements CsvImporter {
  public readonly mode = "companies" as const;

  public async validateRow(
    row: CsvRow,
    line: number,
    ctx: CsvImportContext,
  ): Promise<CsvRowOutcome> {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return zodToErrorOutcome(parsed.error, line);
    const label = formatLabel(parsed.data.name, parsed.data.organisation_ref);

    // Validation outcome : we don't have an entityId yet (no insert).
    // Report what *would* happen on a real commit by reading the DB
    // to know if the ref matches an existing row.
    if (parsed.data.organisation_ref) {
      const existing = await findByOrgRef(ctx.organizationId, parsed.data.organisation_ref);
      if (existing) {
        return { line, status: "updated", entityId: existing.id, label };
      }
    }
    // Synthetic id is OK for preview — never persisted.
    return { line, status: "created", entityId: "__preview__", label };
  }

  public async importRow(
    row: CsvRow,
    line: number,
    ctx: CsvImportContext,
  ): Promise<CsvRowOutcome> {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return zodToErrorOutcome(parsed.error, line);
    const data = parsed.data;

    // Resolve parent FK (best-effort : if unresolved, we still commit
    // without a parent — the user can fix later via the UI).
    let parentId: string | null = null;
    if (data.parent_organisation_ref) {
      const parent = await findByOrgRef(ctx.organizationId, data.parent_organisation_ref);
      parentId = parent?.id ?? null;
    }

    // Map CSV → DB shape. `present-fields only` semantics — undefined
    // fields stay untouched on update.
    const values = buildInsertValues(data, ctx, parentId);
    const label = formatLabel(data.name, data.organisation_ref);

    // Upsert via organisation_ref (composite unique on org + ref).
    if (data.organisation_ref) {
      const existing = await findByOrgRef(ctx.organizationId, data.organisation_ref);
      if (existing) {
        await getDb()
          .update(companies)
          .set(buildUpdateValues(data, parentId))
          .where(
            and(eq(companies.id, existing.id), eq(companies.organizationId, ctx.organizationId)),
          );
        return { line, status: "updated", entityId: existing.id, label };
      }
    }

    const [inserted] = await getDb()
      .insert(companies)
      .values(values)
      .returning({ id: companies.id });

    if (!inserted) {
      return { line, status: "error", message: "insert returned no row" };
    }
    return { line, status: "created", entityId: inserted.id, label };
  }
}

// ---------------------------------------------------------------------------
// Helpers — kept private to the strategy ; not exported.
// ---------------------------------------------------------------------------

async function findByOrgRef(
  orgId: string,
  ref: string,
): Promise<{ id: string } | undefined> {
  return getDb().query.companies.findFirst({
    where: and(
      eq(companies.organizationId, orgId),
      eq(companies.organisationRef, ref),
    ),
    columns: { id: true },
  });
}

function buildInsertValues(
  data: ParsedRow,
  ctx: CsvImportContext,
  parentId: string | null,
): typeof companies.$inferInsert {
  return {
    organizationId: ctx.organizationId,
    organisationRef: data.organisation_ref,
    name: data.name,
    legalName: data.legal_name,
    websiteUrl: data.website_url,
    linkedinUrl: data.linkedin_url,
    relationshipType: data.relationship_type,
    industry: data.industry,
    sizeEstimate: data.size_estimate,
    standing: data.standing,
    primaryLocale: data.primary_locale ?? "fr",
    signalType: data.signal_type,
    signalSource: data.signal_source,
    notes: data.notes,
    parentId,
  };
}

/**
 * Builds the partial UPDATE set : only fields that were *present* in the
 * source row (not blank/missing) make it into the SET clause. This
 * preserves in-app values that aren't in the CSV (scoring, status, etc.).
 */
function buildUpdateValues(
  data: ParsedRow,
  parentId: string | null,
): Partial<typeof companies.$inferInsert> {
  const out: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
  if (data.name != null) out.name = data.name;
  if (data.legal_name !== undefined) out.legalName = data.legal_name;
  if (data.website_url !== undefined) out.websiteUrl = data.website_url;
  if (data.linkedin_url !== undefined) out.linkedinUrl = data.linkedin_url;
  if (data.relationship_type !== undefined) out.relationshipType = data.relationship_type;
  if (data.industry !== undefined) out.industry = data.industry;
  if (data.size_estimate !== undefined) out.sizeEstimate = data.size_estimate;
  if (data.standing !== undefined) out.standing = data.standing;
  if (data.primary_locale !== undefined && data.primary_locale != null) {
    out.primaryLocale = data.primary_locale;
  }
  if (data.signal_type !== undefined) out.signalType = data.signal_type;
  if (data.signal_source !== undefined) out.signalSource = data.signal_source;
  if (data.notes !== undefined) out.notes = data.notes;
  if (data.parent_organisation_ref !== undefined) out.parentId = parentId;
  return out;
}

/**
 * Builds the human-readable Detail-column label for the preview / result
 * table. Shows the company name and the `organisation_ref` when set
 * (e.g. "Example Hotel · ACME-001"). Falls back to just the name otherwise.
 */
function formatLabel(name: string, organisationRef: string | null | undefined): string {
  if (organisationRef) return `${name} · ${organisationRef}`;
  return name;
}

function zodToErrorOutcome(error: z.ZodError, line: number): CsvRowOutcome {
  const issue = error.issues[0];
  return {
    line,
    status: "error",
    message: issue?.message ?? "validation error",
    field: issue?.path?.join(".") ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Zod helpers — narrow Zod refinements that emit `null` for empty cells.
// ---------------------------------------------------------------------------

function nullableString(max: number) {
  return z
    .preprocess(emptyToNull, z.string().trim().max(max).nullable())
    .optional();
}

function nullableUrl() {
  return z
    .preprocess(emptyToNull, z.string().url().max(500).nullable())
    .optional();
}

function nullableInt(min: number, max: number) {
  return z
    .preprocess(
      (v) => {
        if (v === "" || v == null) return null;
        const n = Number(v);
        return Number.isNaN(n) ? v : n;
      },
      z.number().int().min(min).max(max).nullable(),
    )
    .optional();
}

function nullableEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(emptyToNull, z.enum(values).nullable())
    .optional();
}

function emptyToNull(value: unknown): unknown {
  if (value === "" || value == null) return null;
  return value;
}

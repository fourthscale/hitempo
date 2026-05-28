import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { companies, sites } from "@/db/schema";

import {
  type CsvImportContext,
  type CsvImporter,
  type CsvRow,
  type CsvRowOutcome,
} from "../csv-importer";

/**
 * Importer for the **sites** CSV mode.
 *
 * Each row → one site attached to an existing company (required).
 *
 * Linking + business rules :
 *   - `company_organisation_ref` is **required**. The strategy looks it up
 *     in `companies` (filtered by `organizationId`). No match → row errors.
 *   - `is_primary` true ? Before flipping this site to primary, the strategy
 *     unsets any other primary site of the same company (matches the
 *     existing `setPrimaryContactAction` invariant : at most one primary
 *     site per company).
 *   - Upsert by `organisation_ref` (present → update only present fields,
 *     absent → insert).
 *
 * No scoring impact — sites aren't a scoring input.
 */

const SITE_TYPE_VALUES = [
  "office", "hotel", "showroom", "store", "restaurant", "warehouse", "other",
] as const;

const rowSchema = z.object({
  organisation_ref: nullableString(80),
  company_organisation_ref: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  type: nullableEnum(SITE_TYPE_VALUES),
  address_line_1: nullableString(200),
  postal_code: nullableString(20),
  city: nullableString(100),
  region: nullableString(100),
  country: nullableString(2),
  is_primary: nullableBool(),
  standing: nullableInt(1, 5),
  notes: nullableString(2_000),
});

type ParsedRow = z.infer<typeof rowSchema>;

export class SitesCsvImporter implements CsvImporter {
  public readonly mode = "sites" as const;

  public async validateRow(
    row: CsvRow,
    line: number,
    ctx: CsvImportContext,
  ): Promise<CsvRowOutcome> {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return zodToErrorOutcome(parsed.error, line);
    const data = parsed.data;
    const label = formatLabel(data);

    const company = await findCompanyByRef(ctx.organizationId, data.company_organisation_ref);
    if (!company) {
      return {
        line,
        status: "error",
        field: "company_organisation_ref",
        message: `no company with organisation_ref="${data.company_organisation_ref}" in this org`,
      };
    }

    if (data.organisation_ref) {
      const existing = await findSiteByRef(ctx.organizationId, data.organisation_ref);
      if (existing) return { line, status: "updated", entityId: existing.id, label };
    }
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
    const label = formatLabel(data);

    const company = await findCompanyByRef(ctx.organizationId, data.company_organisation_ref);
    if (!company) {
      return {
        line,
        status: "error",
        field: "company_organisation_ref",
        message: `no company with organisation_ref="${data.company_organisation_ref}" in this org`,
      };
    }

    const wantsPrimary = data.is_primary === true;
    const db = getDb();

    // Resolve target row (upsert).
    let siteId: string;
    let status: "created" | "updated";
    if (data.organisation_ref) {
      const existing = await findSiteByRef(ctx.organizationId, data.organisation_ref);
      if (existing) {
        // Unset other primaries BEFORE the row is flipped to primary —
        // partial unique index on (company_id, is_primary=true) might exist
        // in the future and the convention is "at most one primary per company".
        if (wantsPrimary) {
          await unsetOtherPrimarySites(ctx.organizationId, company.id, existing.id);
        }
        await db
          .update(sites)
          .set(buildUpdateValues(data, company.id))
          .where(
            and(eq(sites.id, existing.id), eq(sites.organizationId, ctx.organizationId)),
          );
        siteId = existing.id;
        status = "updated";
      } else {
        if (wantsPrimary) {
          await unsetOtherPrimarySites(ctx.organizationId, company.id, null);
        }
        const inserted = await insertSite(data, ctx, company.id);
        if (!inserted) return { line, status: "error", message: "insert returned no row" };
        siteId = inserted.id;
        status = "created";
      }
    } else {
      if (wantsPrimary) {
        await unsetOtherPrimarySites(ctx.organizationId, company.id, null);
      }
      const inserted = await insertSite(data, ctx, company.id);
      if (!inserted) return { line, status: "error", message: "insert returned no row" };
      siteId = inserted.id;
      status = "created";
    }

    return { line, status, entityId: siteId, label };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function findCompanyByRef(orgId: string, ref: string) {
  return getDb().query.companies.findFirst({
    where: and(eq(companies.organizationId, orgId), eq(companies.organisationRef, ref)),
    columns: { id: true },
  });
}

async function findSiteByRef(orgId: string, ref: string) {
  return getDb().query.sites.findFirst({
    where: and(eq(sites.organizationId, orgId), eq(sites.organisationRef, ref)),
    columns: { id: true },
  });
}

/**
 * Unsets `is_primary` on every site of the company EXCEPT the one being
 * imported (when it's an UPDATE — `excludeId` is the id we want to keep
 * as primary). For INSERTs, pass null and all existing primaries get
 * unset.
 */
async function unsetOtherPrimarySites(
  orgId: string,
  companyId: string,
  excludeId: string | null,
) {
  const baseWhere = and(
    eq(sites.companyId, companyId),
    eq(sites.organizationId, orgId),
    eq(sites.isPrimary, true),
  );
  const whereClause = excludeId ? and(baseWhere, ne(sites.id, excludeId)) : baseWhere;
  await getDb()
    .update(sites)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(whereClause);
}

async function insertSite(
  data: ParsedRow,
  ctx: CsvImportContext,
  companyId: string,
) {
  const [row] = await getDb()
    .insert(sites)
    .values({
      organizationId: ctx.organizationId,
      companyId,
      organisationRef: data.organisation_ref,
      name: data.name,
      type: data.type ?? "office",
      addressLine1: data.address_line_1,
      postalCode: data.postal_code,
      city: data.city,
      region: data.region,
      country: (data.country ?? "FR").toUpperCase(),
      isPrimary: data.is_primary ?? false,
      standing: data.standing,
      notes: data.notes,
    })
    .returning({ id: sites.id });
  return row;
}

function buildUpdateValues(
  data: ParsedRow,
  companyId: string,
): Partial<typeof sites.$inferInsert> {
  const out: Partial<typeof sites.$inferInsert> = {
    updatedAt: new Date(),
    companyId,
  };
  if (data.name != null) out.name = data.name;
  if (data.type !== undefined && data.type != null) out.type = data.type;
  if (data.address_line_1 !== undefined) out.addressLine1 = data.address_line_1;
  if (data.postal_code !== undefined) out.postalCode = data.postal_code;
  if (data.city !== undefined) out.city = data.city;
  if (data.region !== undefined) out.region = data.region;
  if (data.country !== undefined && data.country != null) out.country = data.country.toUpperCase();
  if (data.is_primary !== undefined && data.is_primary != null) out.isPrimary = data.is_primary;
  if (data.standing !== undefined) out.standing = data.standing;
  if (data.notes !== undefined) out.notes = data.notes;
  return out;
}

function formatLabel(data: ParsedRow): string {
  const parts: string[] = [data.name];
  if (data.city) parts.push(data.city);
  if (data.organisation_ref) parts.push(data.organisation_ref);
  return parts.join(" · ");
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
// Zod helpers — same pattern as the other importers.
// ---------------------------------------------------------------------------

function nullableString(max: number) {
  return z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();
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
  return z.preprocess(emptyToNull, z.enum(values).nullable()).optional();
}

function nullableBool() {
  return z
    .preprocess(
      (v) => {
        if (v === "" || v == null) return null;
        if (typeof v === "boolean") return v;
        const s = String(v).toLowerCase().trim();
        if (["true", "1", "yes", "y", "oui"].includes(s)) return true;
        if (["false", "0", "no", "n", "non"].includes(s)) return false;
        return v;
      },
      z.boolean().nullable(),
    )
    .optional();
}

function emptyToNull(value: unknown): unknown {
  if (value === "" || value == null) return null;
  return value;
}

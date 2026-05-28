import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { companies, contacts, sites } from "@/db/schema";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";

import {
  type CsvImportContext,
  type CsvImporter,
  type CsvRow,
  type CsvRowOutcome,
} from "../csv-importer";

/**
 * Importer for the **all-in-one** CSV mode.
 *
 * Each row = one company (required) + an optional site + an optional
 * contact. Everything for that row is committed in **one Drizzle
 * transaction** : if the contact insert fails, the company and site
 * are rolled back too. Per-row tx semantics scoped to this strategy.
 *
 * Section detection (which of site/contact to create) :
 *   - **site**    present iff `site_name` is set (the only required field
 *     of the site section). Other site_* fields tag along.
 *   - **contact** present iff BOTH `contact_first_name` AND
 *     `contact_last_name` are set.
 *
 * Linking :
 *   - company is upserted by `company_organisation_ref`
 *   - site (when present) is upserted by `site_organisation_ref` and
 *     attached to the company row of THIS line
 *   - contact (when present) is upserted by `contact_organisation_ref`,
 *     attached to the company, optionally to the just-imported site
 *
 * Primary flags : `site_is_primary`, `contact_is_primary_for_company`,
 * `contact_is_primary_for_site` are applied inside the same tx.
 *
 * If `contact_is_primary_for_company` flipped (primaryContactId changed)
 * we fire-and-forget a score recompute outside the tx — `hasPrimaryContact`
 * is a scoring input.
 */

const RELATIONSHIP_VALUES = [
  "prospect", "client", "former_client", "prescriber", "partner",
] as const;
const LOCALE_VALUES = ["fr", "en"] as const;
const SITE_TYPE_VALUES = [
  "office", "hotel", "showroom", "store", "restaurant", "warehouse", "other",
] as const;
const ROLE_VALUES = [
  "decision_maker", "influencer", "user", "prescriber", "assistant", "other",
] as const;
const CHANNEL_VALUES = ["email", "phone", "linkedin", "in_person"] as const;

const rowSchema = z.object({
  // Company — required
  company_organisation_ref: nullableString(80),
  company_name: z.string().trim().min(1).max(200),
  company_legal_name: nullableString(200),
  company_website: nullableUrl(),
  company_linkedin_url: nullableUrl(),
  company_industry: nullableString(100),
  company_size_estimate: nullableString(50),
  company_standing: nullableInt(1, 5),
  company_relationship_type: nullableEnum(RELATIONSHIP_VALUES),
  company_primary_locale: nullableEnum(LOCALE_VALUES),
  company_signal_type: nullableString(100),
  company_signal_source: nullableString(200),
  company_notes: nullableString(5_000),
  company_parent_organisation_ref: nullableString(80),
  // Site — optional (presence = site_name set)
  site_organisation_ref: nullableString(80),
  site_name: nullableString(200),
  site_type: nullableEnum(SITE_TYPE_VALUES),
  site_address_line_1: nullableString(200),
  site_postal_code: nullableString(20),
  site_city: nullableString(100),
  site_region: nullableString(100),
  site_country: nullableString(2),
  site_is_primary: nullableBool(),
  site_standing: nullableInt(1, 5),
  site_notes: nullableString(2_000),
  // Contact — optional (presence = first_name + last_name both set)
  contact_organisation_ref: nullableString(80),
  contact_first_name: nullableString(100),
  contact_last_name: nullableString(100),
  contact_job_title: nullableString(150),
  contact_role: nullableEnum(ROLE_VALUES),
  contact_email: nullableEmail(),
  contact_phone: nullableString(50),
  contact_linkedin_url: nullableUrl(),
  contact_preferred_language: nullableString(10),
  contact_preferred_channel: nullableEnum(CHANNEL_VALUES),
  contact_relevance: nullableInt(1, 5),
  contact_is_primary_for_company: nullableBool(),
  contact_is_primary_for_site: nullableBool(),
  contact_notes: nullableString(5_000),
});

type ParsedRow = z.infer<typeof rowSchema>;

export class AllInOneCsvImporter implements CsvImporter {
  public readonly mode = "all-in-one" as const;

  public async validateRow(
    row: CsvRow,
    line: number,
    ctx: CsvImportContext,
  ): Promise<CsvRowOutcome> {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return zodToErrorOutcome(parsed.error, line);
    const data = parsed.data;

    // Cross-field checks
    if (hasContactSection(data)) {
      if (!data.contact_first_name || !data.contact_last_name) {
        return {
          line,
          status: "error",
          field: "contact_first_name",
          message: "contact section requires both first_name and last_name",
        };
      }
    }

    // Preview behaviour : check if the company already exists by ref so
    // we can announce "updated" vs "created" in the summary banner.
    let companyStatus: "created" | "updated" = "created";
    if (data.company_organisation_ref) {
      const existing = await findCompanyByRef(
        ctx.organizationId,
        data.company_organisation_ref,
      );
      if (existing) companyStatus = "updated";
    }

    return {
      line,
      status: companyStatus,
      entityId: "__preview__",
      label: formatLabel(data),
    };
  }

  public async importRow(
    row: CsvRow,
    line: number,
    ctx: CsvImportContext,
  ): Promise<CsvRowOutcome> {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return zodToErrorOutcome(parsed.error, line);
    const data = parsed.data;

    if (hasContactSection(data)) {
      if (!data.contact_first_name || !data.contact_last_name) {
        return {
          line,
          status: "error",
          field: "contact_first_name",
          message: "contact section requires both first_name and last_name",
        };
      }
    }

    let result: CsvRowOutcome;
    let companyPrimaryChanged = false;
    let companyIdForRecompute: string | null = null;

    try {
      result = await getDb().transaction(async (tx) => {
        // ---- 1. Company upsert ----
        const companyResult = await upsertCompany(tx, data, ctx);
        if (companyResult.kind === "error") {
          return { line, ...companyResult.outcome } as CsvRowOutcome;
        }
        const { companyId, status: companyStatus } = companyResult;
        companyIdForRecompute = companyId;

        // ---- 2. Site upsert (optional) ----
        let siteId: string | null = null;
        if (hasSiteSection(data)) {
          const siteResult = await upsertSite(tx, data, ctx, companyId);
          if (siteResult.kind === "error") {
            // Throw to roll back the company upsert.
            throw new Error(`__row_error__${JSON.stringify(siteResult.outcome)}`);
          }
          siteId = siteResult.siteId;
        }

        // ---- 3. Contact upsert (optional) ----
        if (hasContactSection(data)) {
          const contactResult = await upsertContact(tx, data, ctx, companyId, siteId);
          if (contactResult.kind === "error") {
            throw new Error(`__row_error__${JSON.stringify(contactResult.outcome)}`);
          }
          if (contactResult.primaryForCompanyChanged) {
            companyPrimaryChanged = true;
          }
        }

        return {
          line,
          status: companyStatus,
          entityId: companyId,
          label: formatLabel(data),
        };
      });
    } catch (err) {
      // Row-error sentinel : extract the inner outcome.
      if (err instanceof Error && err.message.startsWith("__row_error__")) {
        const inner = JSON.parse(err.message.replace("__row_error__", ""));
        return { line, ...inner };
      }
      throw err;
    }

    if (companyPrimaryChanged && companyIdForRecompute) {
      void recomputeCompanyScore(ctx.organizationId, companyIdForRecompute);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Section detectors
// ---------------------------------------------------------------------------

function hasSiteSection(data: ParsedRow): boolean {
  return data.site_name != null && data.site_name.length > 0;
}

function hasContactSection(data: ParsedRow): boolean {
  return (
    (data.contact_first_name != null && data.contact_first_name.length > 0) ||
    (data.contact_last_name != null && data.contact_last_name.length > 0)
  );
}

// ---------------------------------------------------------------------------
// Section upserts. Each takes a `tx` so the whole row is atomic.
// Drizzle's tx type is inferred from getDb() — we use the loose `unknown`
// at the call site to keep this file self-contained.
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

type UpsertSuccess<T extends string> = { kind: "ok"; companyId?: string; siteId?: string; contactId?: string; status: T };
type UpsertResult =
  | (UpsertSuccess<"created" | "updated"> & { companyId: string })
  | { kind: "error"; outcome: Omit<CsvRowOutcome & { status: "error" }, "line"> };

async function upsertCompany(
  tx: Tx,
  data: ParsedRow,
  ctx: CsvImportContext,
): Promise<UpsertResult> {
  // Resolve parent FK best-effort (same convention as CompaniesCsvImporter).
  let parentId: string | null = null;
  if (data.company_parent_organisation_ref) {
    const parent = await tx.query.companies.findFirst({
      where: and(
        eq(companies.organizationId, ctx.organizationId),
        eq(companies.organisationRef, data.company_parent_organisation_ref),
      ),
      columns: { id: true },
    });
    parentId = parent?.id ?? null;
  }

  if (data.company_organisation_ref) {
    const existing = await tx.query.companies.findFirst({
      where: and(
        eq(companies.organizationId, ctx.organizationId),
        eq(companies.organisationRef, data.company_organisation_ref),
      ),
      columns: { id: true },
    });
    if (existing) {
      const update: Partial<typeof companies.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (data.company_name != null) update.name = data.company_name;
      if (data.company_legal_name !== undefined) update.legalName = data.company_legal_name;
      if (data.company_website !== undefined) update.websiteUrl = data.company_website;
      if (data.company_linkedin_url !== undefined) update.linkedinUrl = data.company_linkedin_url;
      if (data.company_industry !== undefined) update.industry = data.company_industry;
      if (data.company_size_estimate !== undefined) update.sizeEstimate = data.company_size_estimate;
      if (data.company_standing !== undefined) update.standing = data.company_standing;
      if (data.company_relationship_type !== undefined) update.relationshipType = data.company_relationship_type;
      if (data.company_primary_locale !== undefined && data.company_primary_locale != null) update.primaryLocale = data.company_primary_locale;
      if (data.company_signal_type !== undefined) update.signalType = data.company_signal_type;
      if (data.company_signal_source !== undefined) update.signalSource = data.company_signal_source;
      if (data.company_notes !== undefined) update.notes = data.company_notes;
      if (data.company_parent_organisation_ref !== undefined) update.parentId = parentId;

      await tx.update(companies).set(update).where(
        and(eq(companies.id, existing.id), eq(companies.organizationId, ctx.organizationId)),
      );
      return { kind: "ok", companyId: existing.id, status: "updated" };
    }
  }

  const [inserted] = await tx
    .insert(companies)
    .values({
      organizationId: ctx.organizationId,
      organisationRef: data.company_organisation_ref,
      name: data.company_name,
      legalName: data.company_legal_name,
      websiteUrl: data.company_website,
      linkedinUrl: data.company_linkedin_url,
      industry: data.company_industry,
      sizeEstimate: data.company_size_estimate,
      standing: data.company_standing,
      relationshipType: data.company_relationship_type,
      primaryLocale: data.company_primary_locale ?? "fr",
      signalType: data.company_signal_type,
      signalSource: data.company_signal_source,
      notes: data.company_notes,
      parentId,
    })
    .returning({ id: companies.id });
  if (!inserted) {
    return { kind: "error", outcome: { status: "error", message: "company insert returned no row" } };
  }
  return { kind: "ok", companyId: inserted.id, status: "created" };
}

type SiteResult =
  | { kind: "ok"; siteId: string }
  | { kind: "error"; outcome: Omit<CsvRowOutcome & { status: "error" }, "line"> };

async function upsertSite(
  tx: Tx,
  data: ParsedRow,
  ctx: CsvImportContext,
  companyId: string,
): Promise<SiteResult> {
  const wantsPrimary = data.site_is_primary === true;

  if (wantsPrimary) {
    await tx
      .update(sites)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(sites.companyId, companyId),
          eq(sites.organizationId, ctx.organizationId),
          eq(sites.isPrimary, true),
        ),
      );
  }

  if (data.site_organisation_ref) {
    const existing = await tx.query.sites.findFirst({
      where: and(
        eq(sites.organizationId, ctx.organizationId),
        eq(sites.organisationRef, data.site_organisation_ref),
      ),
      columns: { id: true },
    });
    if (existing) {
      // Re-apply the primary-unset for any OTHER row than `existing.id`
      // (if the user listed the same site twice with different primary).
      if (wantsPrimary) {
        await tx
          .update(sites)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(sites.companyId, companyId),
              eq(sites.organizationId, ctx.organizationId),
              eq(sites.isPrimary, true),
              ne(sites.id, existing.id),
            ),
          );
      }
      const update: Partial<typeof sites.$inferInsert> = {
        updatedAt: new Date(),
        companyId,
      };
      if (data.site_name != null) update.name = data.site_name;
      if (data.site_type !== undefined && data.site_type != null) update.type = data.site_type;
      if (data.site_address_line_1 !== undefined) update.addressLine1 = data.site_address_line_1;
      if (data.site_postal_code !== undefined) update.postalCode = data.site_postal_code;
      if (data.site_city !== undefined) update.city = data.site_city;
      if (data.site_region !== undefined) update.region = data.site_region;
      if (data.site_country !== undefined && data.site_country != null) update.country = data.site_country.toUpperCase();
      if (data.site_is_primary !== undefined && data.site_is_primary != null) update.isPrimary = data.site_is_primary;
      if (data.site_standing !== undefined) update.standing = data.site_standing;
      if (data.site_notes !== undefined) update.notes = data.site_notes;

      await tx.update(sites).set(update).where(
        and(eq(sites.id, existing.id), eq(sites.organizationId, ctx.organizationId)),
      );
      return { kind: "ok", siteId: existing.id };
    }
  }

  const [inserted] = await tx
    .insert(sites)
    .values({
      organizationId: ctx.organizationId,
      companyId,
      organisationRef: data.site_organisation_ref,
      name: data.site_name as string, // checked by hasSiteSection
      type: data.site_type ?? "office",
      addressLine1: data.site_address_line_1,
      postalCode: data.site_postal_code,
      city: data.site_city,
      region: data.site_region,
      country: (data.site_country ?? "FR").toUpperCase(),
      isPrimary: data.site_is_primary ?? false,
      standing: data.site_standing,
      notes: data.site_notes,
    })
    .returning({ id: sites.id });
  if (!inserted) {
    return { kind: "error", outcome: { status: "error", message: "site insert returned no row" } };
  }
  return { kind: "ok", siteId: inserted.id };
}

type ContactResult =
  | { kind: "ok"; contactId: string; primaryForCompanyChanged: boolean }
  | { kind: "error"; outcome: Omit<CsvRowOutcome & { status: "error" }, "line"> };

async function upsertContact(
  tx: Tx,
  data: ParsedRow,
  ctx: CsvImportContext,
  companyId: string,
  siteId: string | null,
): Promise<ContactResult> {
  // Upsert by contact_organisation_ref.
  let contactId: string;
  if (data.contact_organisation_ref) {
    const existing = await tx.query.contacts.findFirst({
      where: and(
        eq(contacts.organizationId, ctx.organizationId),
        eq(contacts.organisationRef, data.contact_organisation_ref),
      ),
      columns: { id: true },
    });
    if (existing) {
      const update: Partial<typeof contacts.$inferInsert> = {
        updatedAt: new Date(),
        companyId,
        siteId,
      };
      if (data.contact_first_name != null) update.firstName = data.contact_first_name;
      if (data.contact_last_name != null) update.lastName = data.contact_last_name;
      if (data.contact_job_title !== undefined) update.jobTitle = data.contact_job_title;
      if (data.contact_role !== undefined) update.role = data.contact_role;
      if (data.contact_email !== undefined) update.email = data.contact_email;
      if (data.contact_phone !== undefined) update.phone = data.contact_phone;
      if (data.contact_linkedin_url !== undefined) update.linkedinUrl = data.contact_linkedin_url;
      if (data.contact_preferred_language != null) update.preferredLanguage = data.contact_preferred_language;
      if (data.contact_preferred_channel !== undefined) update.preferredChannel = data.contact_preferred_channel;
      if (data.contact_relevance !== undefined) update.relevance = data.contact_relevance;
      if (data.contact_notes !== undefined) update.notes = data.contact_notes;

      await tx.update(contacts).set(update).where(
        and(eq(contacts.id, existing.id), eq(contacts.organizationId, ctx.organizationId)),
      );
      contactId = existing.id;
    } else {
      const inserted = await insertContact(tx, data, ctx, companyId, siteId);
      if (!inserted) return { kind: "error", outcome: { status: "error", message: "contact insert returned no row" } };
      contactId = inserted.id;
    }
  } else {
    const inserted = await insertContact(tx, data, ctx, companyId, siteId);
    if (!inserted) return { kind: "error", outcome: { status: "error", message: "contact insert returned no row" } };
    contactId = inserted.id;
  }

  // Primary flags.
  let primaryForCompanyChanged = false;
  if (data.contact_is_primary_for_company === true) {
    await tx
      .update(companies)
      .set({ primaryContactId: contactId, updatedAt: new Date() })
      .where(
        and(eq(companies.id, companyId), eq(companies.organizationId, ctx.organizationId)),
      );
    primaryForCompanyChanged = true;
  }
  if (data.contact_is_primary_for_site === true && siteId) {
    await tx
      .update(sites)
      .set({ primaryContactId: contactId, updatedAt: new Date() })
      .where(
        and(eq(sites.id, siteId), eq(sites.organizationId, ctx.organizationId)),
      );
  }

  return { kind: "ok", contactId, primaryForCompanyChanged };
}

async function insertContact(
  tx: Tx,
  data: ParsedRow,
  ctx: CsvImportContext,
  companyId: string,
  siteId: string | null,
) {
  const [row] = await tx
    .insert(contacts)
    .values({
      organizationId: ctx.organizationId,
      companyId,
      siteId,
      organisationRef: data.contact_organisation_ref,
      firstName: data.contact_first_name as string,
      lastName: data.contact_last_name as string,
      jobTitle: data.contact_job_title,
      role: data.contact_role,
      email: data.contact_email,
      phone: data.contact_phone,
      linkedinUrl: data.contact_linkedin_url,
      preferredLanguage: data.contact_preferred_language ?? "fr",
      preferredChannel: data.contact_preferred_channel,
      relevance: data.contact_relevance,
      notes: data.contact_notes,
    })
    .returning({ id: contacts.id });
  return row;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findCompanyByRef(orgId: string, ref: string) {
  return getDb().query.companies.findFirst({
    where: and(eq(companies.organizationId, orgId), eq(companies.organisationRef, ref)),
    columns: { id: true },
  });
}

function formatLabel(data: ParsedRow): string {
  const parts: string[] = [data.company_name];
  if (data.company_organisation_ref) parts.push(data.company_organisation_ref);
  if (hasSiteSection(data) && data.site_city) parts.push(data.site_city);
  if (hasContactSection(data)) {
    parts.push(`${data.contact_first_name} ${data.contact_last_name}`.trim());
  }
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
// Zod helpers (kept local — see the per-mode strategies for the same set).
// ---------------------------------------------------------------------------

function nullableString(max: number) {
  return z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional();
}
function nullableUrl() {
  return z.preprocess(emptyToNull, z.string().url().max(500).nullable()).optional();
}
function nullableEmail() {
  return z.preprocess(emptyToNull, z.string().email().max(200).nullable()).optional();
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

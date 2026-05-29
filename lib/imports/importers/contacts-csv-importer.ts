import "server-only";

import { and, eq } from "drizzle-orm";
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
 * Importer for the **contacts** CSV mode.
 *
 * Each row → one contact attached to an existing company (required) and,
 * optionally, to one of that company's sites.
 *
 * Linking strategy :
 *   - `company_organisation_ref` is **required**. The strategy looks it up
 *     in `companies` (filtered by `organizationId`). No match → row errors.
 *   - `site_organisation_ref` is optional. Looked up in `sites` ; if present
 *     it must belong to the matched company, otherwise the row errors.
 *   - `is_primary_for_company` / `is_primary_for_site` are post-write
 *     side-effects : after insert/update, the strategy patches
 *     `companies.primaryContactId` and/or `sites.primaryContactId`.
 *
 * Upsert : if `organisation_ref` is set AND matches an existing contact in
 * this org → UPDATE (present-fields only). Else INSERT.
 */

const ROLE_VALUES = [
  "decision_maker", "influencer", "user", "prescriber", "assistant", "other",
] as const;

const CHANNEL_VALUES = ["email", "phone", "linkedin", "in_person"] as const;

const KIND_VALUES = ["person", "generic"] as const;

const rowSchema = z
  .object({
    organisation_ref: nullableString(80),
    company_organisation_ref: z.string().trim().min(1).max(80),
    site_organisation_ref: nullableString(80),
    // kind defaults to "person" when the column is absent/empty (backwards
    // compatible with pre-10.8 templates).
    kind: z.preprocess(
      (v) => (v === "" || v == null ? "person" : String(v).toLowerCase().trim()),
      z.enum(KIND_VALUES),
    ),
    // Nullable since 10.8 ; the superRefine enforces the per-kind invariant.
    first_name: nullableString(100),
    last_name: nullableString(100),
    job_title: nullableString(150),
    role: nullableEnum(ROLE_VALUES),
    email: nullableEmail(),
    phone: nullableString(50),
    linkedin_url: nullableUrl(),
    preferred_language: nullableString(10),
    preferred_channel: nullableEnum(CHANNEL_VALUES),
    relevance: nullableInt(1, 5),
    status: nullableString(50),
    is_primary_for_company: nullableBool(),
    is_primary_for_site: nullableBool(),
    notes: nullableString(5_000),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "person") {
      if (!data.first_name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["first_name"], message: "first_name required for a person contact" });
      }
      if (!data.last_name) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["last_name"], message: "last_name required for a person contact" });
      }
    } else if (!data.email && !data.phone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "generic contact requires an email or phone" });
    }
  });

type ParsedRow = z.infer<typeof rowSchema>;

export class ContactsCsvImporter implements CsvImporter {
  public readonly mode = "contacts" as const;

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

    if (data.site_organisation_ref) {
      const site = await findSiteByRef(ctx.organizationId, data.site_organisation_ref);
      if (!site || site.companyId !== company.id) {
        return {
          line,
          status: "error",
          field: "site_organisation_ref",
          message: `no site with organisation_ref="${data.site_organisation_ref}" under that company`,
        };
      }
    }

    if (data.organisation_ref) {
      const existing = await findContactByRef(ctx.organizationId, data.organisation_ref);
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

    // Required company FK.
    const company = await findCompanyByRef(ctx.organizationId, data.company_organisation_ref);
    if (!company) {
      return {
        line,
        status: "error",
        field: "company_organisation_ref",
        message: `no company with organisation_ref="${data.company_organisation_ref}" in this org`,
      };
    }

    // Optional site FK (must belong to the matched company).
    let siteId: string | null = null;
    if (data.site_organisation_ref) {
      const site = await findSiteByRef(ctx.organizationId, data.site_organisation_ref);
      if (!site || site.companyId !== company.id) {
        return {
          line,
          status: "error",
          field: "site_organisation_ref",
          message: `no site with organisation_ref="${data.site_organisation_ref}" under that company`,
        };
      }
      siteId = site.id;
    }

    // Upsert.
    let contactId: string;
    let status: "created" | "updated";
    if (data.organisation_ref) {
      const existing = await findContactByRef(ctx.organizationId, data.organisation_ref);
      if (existing) {
        await getDb()
          .update(contacts)
          .set(buildUpdateValues(data, company.id, siteId))
          .where(
            and(
              eq(contacts.id, existing.id),
              eq(contacts.organizationId, ctx.organizationId),
            ),
          );
        contactId = existing.id;
        status = "updated";
      } else {
        const inserted = await insertContact(data, ctx, company.id, siteId);
        if (!inserted) return { line, status: "error", message: "insert returned no row" };
        contactId = inserted.id;
        status = "created";
      }
    } else {
      const inserted = await insertContact(data, ctx, company.id, siteId);
      if (!inserted) return { line, status: "error", message: "insert returned no row" };
      contactId = inserted.id;
      status = "created";
    }

    // Side-effects : primary flags.
    let companyPrimaryChanged = false;
    if (data.is_primary_for_company === true) {
      await getDb()
        .update(companies)
        .set({ primaryContactId: contactId, updatedAt: new Date() })
        .where(
          and(
            eq(companies.id, company.id),
            eq(companies.organizationId, ctx.organizationId),
          ),
        );
      companyPrimaryChanged = true;
    }
    if (data.is_primary_for_site === true && siteId) {
      await getDb()
        .update(sites)
        .set({ primaryContactId: contactId, updatedAt: new Date() })
        .where(
          and(eq(sites.id, siteId), eq(sites.organizationId, ctx.organizationId)),
        );
    }

    // Score recompute : `hasPrimaryContact` is a scoring input ; if the
    // primary contact changed, the score may move. Fire-and-forget so we
    // don't slow the per-row commit.
    if (companyPrimaryChanged) {
      void recomputeCompanyScore(ctx.organizationId, company.id);
    }

    return { line, status, entityId: contactId, label };
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
    columns: { id: true, companyId: true },
  });
}

async function findContactByRef(orgId: string, ref: string) {
  return getDb().query.contacts.findFirst({
    where: and(eq(contacts.organizationId, orgId), eq(contacts.organisationRef, ref)),
    columns: { id: true },
  });
}

async function insertContact(
  data: ParsedRow,
  ctx: CsvImportContext,
  companyId: string,
  siteId: string | null,
) {
  const [row] = await getDb()
    .insert(contacts)
    .values({
      organizationId: ctx.organizationId,
      companyId,
      siteId,
      organisationRef: data.organisation_ref,
      kind: data.kind,
      firstName: data.first_name,
      lastName: data.last_name,
      jobTitle: data.job_title,
      role: data.role,
      email: data.email,
      phone: data.phone,
      linkedinUrl: data.linkedin_url,
      preferredLanguage: data.preferred_language ?? "fr",
      preferredChannel: data.preferred_channel,
      relevance: data.relevance,
      status: data.status ?? "to_contact",
      notes: data.notes,
    })
    .returning({ id: contacts.id });
  return row;
}

/**
 * Partial UPDATE set : only fields present in the source row make it in.
 * Preserves in-app fields not carried by the CSV (lastContactedAt,
 * optedOut, emailValidated, …).
 */
function buildUpdateValues(
  data: ParsedRow,
  companyId: string,
  siteId: string | null,
): Partial<typeof contacts.$inferInsert> {
  const out: Partial<typeof contacts.$inferInsert> = {
    updatedAt: new Date(),
    companyId,
    siteId,
    kind: data.kind,
  };
  if (data.first_name != null) out.firstName = data.first_name;
  if (data.last_name != null) out.lastName = data.last_name;
  if (data.job_title !== undefined) out.jobTitle = data.job_title;
  if (data.role !== undefined) out.role = data.role;
  if (data.email !== undefined) out.email = data.email;
  if (data.phone !== undefined) out.phone = data.phone;
  if (data.linkedin_url !== undefined) out.linkedinUrl = data.linkedin_url;
  if (data.preferred_language != null) out.preferredLanguage = data.preferred_language;
  if (data.preferred_channel !== undefined) out.preferredChannel = data.preferred_channel;
  if (data.relevance !== undefined) out.relevance = data.relevance;
  if (data.status != null) out.status = data.status;
  if (data.notes !== undefined) out.notes = data.notes;
  return out;
}

function formatLabel(data: ParsedRow): string {
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
    data.email ||
    data.phone ||
    "Contact générique";
  if (data.organisation_ref) return `${name} · ${data.organisation_ref}`;
  if (data.email && !name.includes(data.email)) return `${name} · ${data.email}`;
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
// Zod helpers (mirrors companies-csv-importer.ts — kept local to avoid
// premature abstraction ; if a 4th strategy needs them too we'll lift.)
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

function nullableEmail() {
  return z
    .preprocess(emptyToNull, z.string().email().max(200).nullable())
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

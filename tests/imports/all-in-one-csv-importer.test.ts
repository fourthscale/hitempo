import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/scoring/recompute", () => ({
  recomputeCompanyScore: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from "@/db/client";
import { AllInOneCsvImporter } from "@/lib/imports/importers/all-in-one-csv-importer";
import type { CsvImportContext } from "@/lib/imports/csv-importer";

const ORG = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const ctx: CsvImportContext = { organizationId: ORG, userId: USER };

/**
 * Lightweight fake of the Drizzle handle. We stub :
 *   - `transaction(cb)` → just runs the callback with the same fake (no
 *     real rollback — we track inserts/updates instead and assert what
 *     was attempted).
 *   - `query.<table>.findFirst` → returns the seeded singleton per table.
 *   - `insert(table).values(v).returning()` → records v + returns a synthetic id.
 *   - `update(table).set(v).where(...)` → records v.
 *
 * The `table` argument to `insert/update` is the Drizzle table reference ;
 * we identify it by the `name` baked into the schema definition.
 */
function makeFakeDb(opts: {
  company?: { id: string; organisationRef: string };
  site?: { id: string; organisationRef: string };
  contact?: { id: string; organisationRef: string };
} = {}) {
  const seedCompany = opts.company;
  const seedSite = opts.site;
  const seedContact = opts.contact;

  const insertedCompanies: unknown[] = [];
  const insertedSites: unknown[] = [];
  const insertedContacts: unknown[] = [];
  const updatedCompanies: unknown[] = [];
  const updatedSites: unknown[] = [];
  const updatedContacts: unknown[] = [];

  let nextCompanyId = 1000;
  let nextSiteId = 2000;
  let nextContactId = 3000;

  // We can't reliably introspect drizzle's table reference object across
  // versions, so we use a tiny heuristic : tables expose `.name` /
  // `_.name` somewhere. Falling back to the inserted shape (presence of
  // `firstName` etc.) keeps tests robust.
  function tableName(t: unknown): "companies" | "sites" | "contacts" | "unknown" {
    const obj = t as Record<string, unknown>;
    const name = (obj?._ as { name?: string } | undefined)?.name ?? obj?.name;
    if (name === "companies" || name === "sites" || name === "contacts") return name;
    return "unknown";
  }

  function classifyByShape(values: Record<string, unknown>): "companies" | "sites" | "contacts" {
    if ("firstName" in values || "lastName" in values) return "contacts";
    if ("isPrimary" in values || "country" in values || "addressLine1" in values) return "sites";
    return "companies";
  }

  const fakeDb: unknown = {
    query: {
      companies: { findFirst: async () => seedCompany },
      sites:     { findFirst: async () => seedSite },
      contacts:  { findFirst: async () => seedContact },
    },
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const t = tableName(table) === "unknown" ? classifyByShape(v) : tableName(table);
          if (t === "companies") {
            insertedCompanies.push(v);
            return [{ id: `co-${nextCompanyId++}` }];
          }
          if (t === "sites") {
            insertedSites.push(v);
            return [{ id: `site-${nextSiteId++}` }];
          }
          insertedContacts.push(v);
          return [{ id: `contact-${nextContactId++}` }];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          const t = tableName(table) === "unknown" ? classifyByShape(v) : tableName(table);
          if (t === "companies") updatedCompanies.push(v);
          else if (t === "sites") updatedSites.push(v);
          else updatedContacts.push(v);
          return [];
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeDb),
  };

  return {
    insertedCompanies,
    insertedSites,
    insertedContacts,
    updatedCompanies,
    updatedSites,
    updatedContacts,
    db: fakeDb,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("AllInOneCsvImporter.validateRow", () => {
  it("errors when company_name is missing", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();
    const out = await importer.validateRow({}, 2, ctx);
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("company_name");
  });

  it("succeeds on company-only row", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();
    const out = await importer.validateRow(
      { company_name: "Acme" },
      2,
      ctx,
    );
    expect(out.status).toBe("created");
  });

  it("errors if contact_first_name is set without contact_last_name", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();
    const out = await importer.validateRow(
      { company_name: "Acme", contact_first_name: "Jane" },
      2,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("contact_first_name");
  });

  it("reports 'updated' for company preview when org_ref matches an existing company", async () => {
    const fake = makeFakeDb({
      company: { id: "co-existing", organisationRef: "ACME-001" },
    });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();
    const out = await importer.validateRow(
      { company_organisation_ref: "ACME-001", company_name: "Acme Updated" },
      2,
      ctx,
    );
    expect(out.status).toBe("updated");
  });
});

// ---------------------------------------------------------------------------
// Import — composition behavior
// ---------------------------------------------------------------------------

describe("AllInOneCsvImporter.importRow", () => {
  it("creates a company only when site/contact sections are absent", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();

    const out = await importer.importRow(
      { company_name: "Acme" },
      2,
      ctx,
    );

    expect(out.status).toBe("created");
    expect(fake.insertedCompanies).toHaveLength(1);
    expect(fake.insertedSites).toHaveLength(0);
    expect(fake.insertedContacts).toHaveLength(0);
  });

  it("creates company + site when site_name is set", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();

    await importer.importRow(
      {
        company_name: "Acme",
        site_name: "HQ",
        site_city: "Paris",
      },
      2,
      ctx,
    );

    expect(fake.insertedCompanies).toHaveLength(1);
    expect(fake.insertedSites).toHaveLength(1);
    expect(fake.insertedContacts).toHaveLength(0);
  });

  it("creates company + contact when both contact names are set", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();

    await importer.importRow(
      {
        company_name: "Acme",
        contact_first_name: "Jane",
        contact_last_name: "Doe",
      },
      2,
      ctx,
    );

    expect(fake.insertedCompanies).toHaveLength(1);
    expect(fake.insertedSites).toHaveLength(0);
    expect(fake.insertedContacts).toHaveLength(1);
  });

  it("creates the full triple in one row", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();

    const out = await importer.importRow(
      {
        company_name: "Acme",
        site_name: "HQ",
        contact_first_name: "Jane",
        contact_last_name: "Doe",
      },
      2,
      ctx,
    );

    expect(out.status).toBe("created");
    expect(fake.insertedCompanies).toHaveLength(1);
    expect(fake.insertedSites).toHaveLength(1);
    expect(fake.insertedContacts).toHaveLength(1);
  });

  it("uppercases site_country", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new AllInOneCsvImporter();

    await importer.importRow(
      { company_name: "Acme", site_name: "HQ", site_country: "fr" },
      2,
      ctx,
    );

    const inserted = fake.insertedSites[0] as { country: string };
    expect(inserted.country).toBe("FR");
  });
});

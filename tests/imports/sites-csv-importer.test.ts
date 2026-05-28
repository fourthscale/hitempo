import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@/db/client";
import { SitesCsvImporter } from "@/lib/imports/importers/sites-csv-importer";
import type { CsvImportContext } from "@/lib/imports/csv-importer";

const ORG = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const ctx: CsvImportContext = { organizationId: ORG, userId: USER };

function makeFakeDb(opts: {
  companies?: Array<{ id: string; organisationRef: string }>;
  sites?: Array<{ id: string; organisationRef: string }>;
} = {}) {
  const seedCompanies = opts.companies ?? [];
  const seedSites = opts.sites ?? [];

  const insertedSites: unknown[] = [];
  const updatedSites: unknown[] = [];
  const unsetPrimaries: number[] = []; // number of "unset other primary" UPDATE calls
  let nextId = 9000;

  return {
    insertedSites,
    updatedSites,
    unsetPrimaries,
    db: {
      query: {
        companies: { findFirst: async () => seedCompanies[0] },
        sites: { findFirst: async () => seedSites[0] },
      },
      insert: () => ({
        values: (v: unknown) => ({
          returning: async () => {
            const id = `site-${nextId++}`;
            insertedSites.push(v);
            return [{ id }];
          },
        }),
      }),
      update: () => ({
        set: (v: unknown) => ({
          where: async () => {
            // Heuristic : if the SET contains `isPrimary: false`, it's
            // the "unset other primary" call. Anything else = the actual
            // row UPDATE.
            const values = v as { isPrimary?: boolean };
            if (values.isPrimary === false) {
              unsetPrimaries.push(unsetPrimaries.length);
            } else {
              updatedSites.push(v);
            }
            return [];
          },
        }),
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("SitesCsvImporter.validateRow", () => {
  it("errors when company_organisation_ref is missing", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();
    const out = await importer.validateRow({ name: "HQ" }, 2, ctx);
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("company_organisation_ref");
  });

  it("errors when the company doesn't resolve", async () => {
    const fake = makeFakeDb({ companies: [] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();
    const out = await importer.validateRow(
      { name: "HQ", company_organisation_ref: "ACME-001" },
      2,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toBe("company_organisation_ref");
  });

  it("succeeds when the row is valid and the company exists", async () => {
    const fake = makeFakeDb({ companies: [{ id: "c1", organisationRef: "ACME-001" }] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();
    const out = await importer.validateRow(
      { name: "HQ", company_organisation_ref: "ACME-001" },
      2,
      ctx,
    );
    expect(out.status).toBe("created");
  });

  it("errors when type is not a known enum value", async () => {
    const fake = makeFakeDb({ companies: [{ id: "c1", organisationRef: "ACME-001" }] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();
    const out = await importer.validateRow(
      { name: "HQ", company_organisation_ref: "ACME-001", type: "spaceship" },
      2,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("type");
  });
});

// ---------------------------------------------------------------------------
// Import side-effects
// ---------------------------------------------------------------------------

describe("SitesCsvImporter.importRow", () => {
  it("unsets other primary sites when is_primary=true on insert", async () => {
    const fake = makeFakeDb({ companies: [{ id: "c1", organisationRef: "ACME-001" }] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();

    const out = await importer.importRow(
      { name: "HQ", company_organisation_ref: "ACME-001", is_primary: "true" },
      2,
      ctx,
    );

    expect(out.status).toBe("created");
    expect(fake.unsetPrimaries.length).toBe(1);
    expect(fake.insertedSites).toHaveLength(1);
  });

  it("does NOT unset primaries when is_primary is absent", async () => {
    const fake = makeFakeDb({ companies: [{ id: "c1", organisationRef: "ACME-001" }] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();

    await importer.importRow(
      { name: "HQ", company_organisation_ref: "ACME-001" },
      2,
      ctx,
    );

    expect(fake.unsetPrimaries.length).toBe(0);
  });

  it("uppercases country code on insert (FR convention)", async () => {
    const fake = makeFakeDb({ companies: [{ id: "c1", organisationRef: "ACME-001" }] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new SitesCsvImporter();

    await importer.importRow(
      { name: "HQ", company_organisation_ref: "ACME-001", country: "fr" },
      2,
      ctx,
    );

    const inserted = fake.insertedSites[0] as { country: string };
    expect(inserted.country).toBe("FR");
  });
});

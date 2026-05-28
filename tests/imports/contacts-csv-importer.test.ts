import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/scoring/recompute", () => ({
  recomputeCompanyScore: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from "@/db/client";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { ContactsCsvImporter } from "@/lib/imports/importers/contacts-csv-importer";
import type { CsvImportContext } from "@/lib/imports/csv-importer";

const ORG = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const ctx: CsvImportContext = { organizationId: ORG, userId: USER };

type FakeCompany = { id: string; organisationRef: string };
type FakeSite = { id: string; companyId: string; organisationRef: string };
type FakeContact = { id: string; organisationRef: string };

function makeFakeDb(opts: {
  companies?: FakeCompany[];
  sites?: FakeSite[];
  contacts?: FakeContact[];
} = {}) {
  const seedCompanies = opts.companies ?? [];
  const seedSites = opts.sites ?? [];
  const seedContacts = opts.contacts ?? [];

  const insertedContacts: unknown[] = [];
  const updatedContacts: unknown[] = [];
  const companyUpdates: Array<{ values: unknown }> = [];
  const siteUpdates: Array<{ values: unknown }> = [];

  // Use a marker passed via the table object so each findFirst knows
  // which seed to look up against.
  let nextId = 5000;
  let lastTable: "companies" | "sites" | "contacts" = "companies";

  const findFirst = vi.fn(async () => {
    if (lastTable === "companies") return seedCompanies[0];
    if (lastTable === "sites") return seedSites[0];
    return seedContacts[0];
  });

  return {
    insertedContacts,
    updatedContacts,
    companyUpdates,
    siteUpdates,
    setNextLookup: (t: "companies" | "sites" | "contacts") => {
      lastTable = t;
    },
    db: {
      query: {
        companies: { findFirst: () => {
          lastTable = "companies";
          return findFirst();
        }},
        sites:     { findFirst: () => {
          lastTable = "sites";
          return findFirst();
        }},
        contacts:  { findFirst: () => {
          lastTable = "contacts";
          return findFirst();
        }},
      },
      insert: (table: unknown) => ({
        values: (v: unknown) => ({
          returning: async () => {
            const id = `contact-${nextId++}`;
            if (table === "contacts" || true) {
              insertedContacts.push(v);
            }
            return [{ id }];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (v: unknown) => ({
          where: async () => {
            // We can't introspect drizzle's table refs reliably ; route
            // updates via the seeded singletons we hold a ref to.
            const tableRef = table as { _?: { name?: string } };
            const name = tableRef?._?.name;
            if (name === "companies") companyUpdates.push({ values: v });
            else if (name === "sites") siteUpdates.push({ values: v });
            else updatedContacts.push(v);
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

describe("ContactsCsvImporter.validateRow", () => {
  it("errors when company_organisation_ref is missing", async () => {
    const fake = makeFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();
    const out = await importer.validateRow(
      { first_name: "Jane", last_name: "Doe" },
      2,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("company_organisation_ref");
  });

  it("errors when the company_organisation_ref doesn't resolve", async () => {
    const fake = makeFakeDb({ companies: [] });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();
    const out = await importer.validateRow(
      { first_name: "Jane", last_name: "Doe", company_organisation_ref: "ACME-001" },
      2,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toBe("company_organisation_ref");
  });

  it("succeeds when the row is valid and the company exists", async () => {
    const fake = makeFakeDb({
      companies: [{ id: "c1", organisationRef: "ACME-001" }],
    });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();
    const out = await importer.validateRow(
      {
        first_name: "Jane",
        last_name: "Doe",
        company_organisation_ref: "ACME-001",
      },
      2,
      ctx,
    );
    expect(out.status).toBe("created");
  });

  it("errors when first_name is missing", async () => {
    const fake = makeFakeDb({
      companies: [{ id: "c1", organisationRef: "ACME-001" }],
    });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();
    const out = await importer.validateRow(
      { last_name: "Doe", company_organisation_ref: "ACME-001" },
      3,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("first_name");
  });

  it("errors when email is malformed", async () => {
    const fake = makeFakeDb({
      companies: [{ id: "c1", organisationRef: "ACME-001" }],
    });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();
    const out = await importer.validateRow(
      {
        first_name: "Jane",
        last_name: "Doe",
        company_organisation_ref: "ACME-001",
        email: "not-an-email",
      },
      3,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("email");
  });
});

// ---------------------------------------------------------------------------
// Import side-effects
// ---------------------------------------------------------------------------

describe("ContactsCsvImporter.importRow", () => {
  it("triggers a score recompute when is_primary_for_company=true", async () => {
    const fake = makeFakeDb({
      companies: [{ id: "c1", organisationRef: "ACME-001" }],
    });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();

    const out = await importer.importRow(
      {
        first_name: "Jane",
        last_name: "Doe",
        company_organisation_ref: "ACME-001",
        is_primary_for_company: "true",
      },
      2,
      ctx,
    );

    expect(out.status).toBe("created");
    // Wait a tick for the fire-and-forget void promise to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(recomputeCompanyScore).toHaveBeenCalledWith(ORG, "c1");
  });

  it("does NOT trigger a recompute when is_primary_for_company is absent", async () => {
    const fake = makeFakeDb({
      companies: [{ id: "c1", organisationRef: "ACME-001" }],
    });
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new ContactsCsvImporter();

    await importer.importRow(
      {
        first_name: "Jane",
        last_name: "Doe",
        company_organisation_ref: "ACME-001",
      },
      2,
      ctx,
    );

    expect(recomputeCompanyScore).not.toHaveBeenCalled();
  });
});

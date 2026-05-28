import { describe, it, expect, beforeEach, vi } from "vitest";

// We mock the DB client so the strategy can be exercised without a postgres
// connection. Each test rewires `getDb()` to return a small in-memory fake
// that captures inserts/updates and answers `findFirst`.

vi.mock("@/db/client", () => {
  return {
    getDb: vi.fn(),
  };
});

import { getDb } from "@/db/client";
import { CompaniesCsvImporter } from "@/lib/imports/importers/companies-csv-importer";
import type { CsvImportContext } from "@/lib/imports/csv-importer";

const ORG = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const ctx: CsvImportContext = { organizationId: ORG, userId: USER };

type FakeCompany = { id: string; organisationRef: string | null };

function makeFakeDb(seed: FakeCompany[] = []) {
  const inserted: unknown[] = [];
  const updated: Array<{ id: string; values: unknown }> = [];
  let nextId = 1000;

  const findFirst = vi.fn(async ({ where }: { where: unknown }) => {
    // We can't introspect drizzle's `and(eq(...), eq(...))`. Convention :
    // we look at the seed for the matching `organisationRef` via a side-band
    // — every test sets `seed` to what should be findable.
    void where;
    const lastQueriedRef = (findFirst as unknown as { __lastRef?: string }).__lastRef;
    if (lastQueriedRef) {
      return seed.find((c) => c.organisationRef === lastQueriedRef);
    }
    return undefined;
  });

  return {
    inserted,
    updated,
    findFirst,
    db: {
      query: {
        companies: {
          findFirst: (args: { where: unknown }) => findFirst(args),
        },
      },
      insert: () => ({
        values: (v: unknown) => ({
          returning: async () => {
            const id = `inserted-${nextId++}`;
            inserted.push(v);
            return [{ id }];
          },
        }),
      }),
      update: () => ({
        set: (v: unknown) => ({
          where: async () => {
            updated.push({ id: "matched", values: v });
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
// Validation (no DB writes)
// ---------------------------------------------------------------------------

describe("CompaniesCsvImporter.validateRow", () => {
  it("returns 'created' when the row is valid and no ref matches", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.validateRow(
      { name: "Example Hotel", relationship_type: "prospect" },
      2,
      ctx,
    );
    expect(out.status).toBe("created");
  });

  it("returns 'updated' when an existing company shares the organisation_ref", async () => {
    const fake = makeFakeDb([{ id: "existing-1", organisationRef: "ACME-001" }]);
    // Tell the fake which ref the next findFirst should match against.
    (fake.findFirst as unknown as { __lastRef?: string }).__lastRef = "ACME-001";
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.validateRow(
      { organisation_ref: "ACME-001", name: "Example Hotel" },
      2,
      ctx,
    );
    expect(out.status).toBe("updated");
    if (out.status === "updated") expect(out.entityId).toBe("existing-1");
  });

  it("returns 'error' when `name` is missing (required)", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.validateRow({}, 5, ctx);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.field).toContain("name");
    }
  });

  it("returns 'error' when relationship_type is not an enum value", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.validateRow(
      { name: "Acme", relationship_type: "not-a-type" },
      3,
      ctx,
    );
    expect(out.status).toBe("error");
  });

  it("returns 'error' when standing is out of [1..5]", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.validateRow(
      { name: "Acme", standing: "9" },
      4,
      ctx,
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.field).toContain("standing");
  });

  it("accepts empty/null cells for optional columns", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.validateRow(
      { name: "Acme", legal_name: null, website_url: "", industry: "" },
      2,
      ctx,
    );
    expect(out.status).toBe("created");
  });
});

// ---------------------------------------------------------------------------
// Import (would write)
// ---------------------------------------------------------------------------

describe("CompaniesCsvImporter.importRow", () => {
  it("inserts a new row when no organisation_ref is present", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.importRow(
      { name: "Example Hotel", industry: "hospitality" },
      2,
      ctx,
    );
    expect(out.status).toBe("created");
    expect(fake.inserted).toHaveLength(1);
    expect(fake.updated).toHaveLength(0);
  });

  it("updates an existing row when the organisation_ref matches", async () => {
    const fake = makeFakeDb([{ id: "existing-1", organisationRef: "ACME-001" }]);
    (fake.findFirst as unknown as { __lastRef?: string }).__lastRef = "ACME-001";
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.importRow(
      { organisation_ref: "ACME-001", name: "Acme renamed" },
      3,
      ctx,
    );
    expect(out.status).toBe("updated");
    if (out.status === "updated") expect(out.entityId).toBe("existing-1");
    expect(fake.inserted).toHaveLength(0);
    expect(fake.updated).toHaveLength(1);
  });

  it("does not throw on invalid row, returns 'error' outcome", async () => {
    const fake = makeFakeDb([]);
    vi.mocked(getDb).mockReturnValue(fake.db as never);
    const importer = new CompaniesCsvImporter();

    const out = await importer.importRow(
      { name: "", relationship_type: "prospect" },
      7,
      ctx,
    );
    expect(out.status).toBe("error");
    expect(fake.inserted).toHaveLength(0);
  });
});

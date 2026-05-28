import { describe, it, expect } from "vitest";

import { parseCsvStream } from "@/lib/imports/csv-parser";
import { CsvImportInvalidFileError } from "@/lib/imports/csv-import-errors";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("parseCsvStream", () => {
  it("yields one row per non-empty data line", async () => {
    const csv = "name,city\r\nAcme,Paris\r\nBeta,Lyon\r\n";
    const rows = await collect(parseCsvStream(csv));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.data).toEqual({ name: "Acme", city: "Paris" });
    expect(rows[1]!.data).toEqual({ name: "Beta", city: "Lyon" });
  });

  it("reports 1-based line numbers (header is line 1, first data row is line 2)", async () => {
    const csv = "a,b\r\nx,y\r\nz,w\r\n";
    const rows = await collect(parseCsvStream(csv));
    expect(rows[0]!.line).toBe(2);
    expect(rows[1]!.line).toBe(3);
  });

  it("converts empty cells to null", async () => {
    const csv = "name,city,country\r\nAcme,,FR\r\n";
    const rows = await collect(parseCsvStream(csv));
    expect(rows[0]!.data).toEqual({ name: "Acme", city: null, country: "FR" });
  });

  it("handles quoted fields with commas", async () => {
    const csv = `name,notes\r\nAcme,"Big, important note"\r\n`;
    const rows = await collect(parseCsvStream(csv));
    expect(rows[0]!.data).toEqual({
      name: "Acme",
      notes: "Big, important note",
    });
  });

  it("trims whitespace around values and headers", async () => {
    const csv = "  name , city \r\n  Acme  , Paris \r\n";
    const rows = await collect(parseCsvStream(csv));
    expect(rows[0]!.data).toEqual({ name: "Acme", city: "Paris" });
  });

  it("skips empty lines", async () => {
    const csv = "name\r\nAcme\r\n\r\nBeta\r\n";
    const rows = await collect(parseCsvStream(csv));
    expect(rows).toHaveLength(2);
  });

  it("throws CsvImportInvalidFileError on an empty file", async () => {
    await expect(collect(parseCsvStream(""))).rejects.toBeInstanceOf(
      CsvImportInvalidFileError,
    );
  });

  it("throws CsvImportInvalidFileError when the row cap is exceeded", async () => {
    const lines = ["name"];
    for (let i = 0; i < 5; i++) lines.push(`row-${i}`);
    const csv = lines.join("\r\n") + "\r\n";
    await expect(
      collect(parseCsvStream(csv, { maxRows: 3 })),
    ).rejects.toBeInstanceOf(CsvImportInvalidFileError);
  });
});

import { describe, it, expect } from "vitest";

import { CSV_IMPORT_MODES } from "@/lib/imports/csv-importer";
import {
  getCsvHeaders,
  getCsvTemplate,
  renderCsvTemplate,
} from "@/lib/imports/csv-template-headers";

describe("csv-template-headers — invariants across all modes", () => {
  for (const mode of CSV_IMPORT_MODES) {
    it(`[${mode}] declares non-empty headers`, () => {
      const headers = getCsvHeaders(mode);
      expect(headers.length).toBeGreaterThan(0);
    });

    it(`[${mode}] example row matches header length`, () => {
      const { headers, example } = getCsvTemplate(mode);
      expect(example.length).toBe(headers.length);
    });

    it(`[${mode}] header names are unique within the mode`, () => {
      const headers = getCsvHeaders(mode);
      const set = new Set(headers);
      expect(set.size).toBe(headers.length);
    });
  }
});

describe("renderCsvTemplate", () => {
  it("starts with the header row in canonical order", () => {
    const csv = renderCsvTemplate("companies");
    const firstLine = csv.split("\r\n")[0]!;
    const expected = getCsvHeaders("companies").join(",");
    expect(firstLine).toBe(expected);
  });

  it("includes exactly two non-empty lines (header + example)", () => {
    const csv = renderCsvTemplate("contacts");
    const lines = csv.split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });

  it("does not put quotes around cells without special characters", () => {
    const csv = renderCsvTemplate("companies");
    // The example has `Example Hotel` — no commas or quotes, should NOT be quoted.
    expect(csv).toContain("Example Hotel,");
    expect(csv).not.toContain('"Example Hotel"');
  });

  it("round-trips through the parser : downloaded template = re-uploadable", async () => {
    const { parseCsvStream } = await import("@/lib/imports/csv-parser");
    const csv = renderCsvTemplate("companies");
    const rows: Array<{ line: number; data: Record<string, string | null> }> =
      [];
    for await (const row of parseCsvStream(csv)) rows.push(row);
    // Header + 1 example row → 1 parsed row.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.name).toBe("Example Hotel");
  });

  it("emits CRLF line endings (RFC 4180 conformant)", () => {
    const csv = renderCsvTemplate("sites");
    expect(csv).toMatch(/\r\n/);
  });

  it("all-in-one template includes both company_ and site_ and contact_ prefixed columns", () => {
    const headers = getCsvHeaders("all-in-one");
    expect(headers.some((h) => h.startsWith("company_"))).toBe(true);
    expect(headers.some((h) => h.startsWith("site_"))).toBe(true);
    expect(headers.some((h) => h.startsWith("contact_"))).toBe(true);
  });
});

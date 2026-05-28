import { describe, it, expect } from "vitest";

import { CSV_IMPORT_MODES } from "@/lib/imports/csv-importer";
import { CsvImporterFactory } from "@/lib/imports/csv-importer-factory";
import { CsvImportInvalidModeError } from "@/lib/imports/csv-import-errors";
import { AllInOneCsvImporter } from "@/lib/imports/importers/all-in-one-csv-importer";
import { CompaniesCsvImporter } from "@/lib/imports/importers/companies-csv-importer";
import { ContactsCsvImporter } from "@/lib/imports/importers/contacts-csv-importer";
import { SitesCsvImporter } from "@/lib/imports/importers/sites-csv-importer";

describe("CsvImporterFactory.getInstance", () => {
  for (const mode of CSV_IMPORT_MODES) {
    it(`returns a CsvImporter for mode "${mode}"`, () => {
      const importer = CsvImporterFactory.getInstance(mode);
      expect(importer.mode).toBe(mode);
    });
  }

  it("returns the real CompaniesCsvImporter for companies mode", () => {
    const importer = CsvImporterFactory.getInstance("companies");
    expect(importer).toBeInstanceOf(CompaniesCsvImporter);
  });

  it("returns the real ContactsCsvImporter for contacts mode", () => {
    const importer = CsvImporterFactory.getInstance("contacts");
    expect(importer).toBeInstanceOf(ContactsCsvImporter);
  });

  it("returns the real SitesCsvImporter for sites mode", () => {
    const importer = CsvImporterFactory.getInstance("sites");
    expect(importer).toBeInstanceOf(SitesCsvImporter);
  });

  it("returns the real AllInOneCsvImporter for all-in-one mode", () => {
    const importer = CsvImporterFactory.getInstance("all-in-one");
    expect(importer).toBeInstanceOf(AllInOneCsvImporter);
  });

  it("throws CsvImportInvalidModeError on an unknown mode", () => {
    expect(() =>
      // @ts-expect-error — purposely testing the runtime guard
      CsvImporterFactory.getInstance("not-a-mode"),
    ).toThrow(CsvImportInvalidModeError);
  });
});

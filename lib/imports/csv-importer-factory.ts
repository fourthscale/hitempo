import "server-only";

import {
  CSV_IMPORT_MODES,
  type CsvImporter,
  type CsvImportMode,
} from "./csv-importer";
import { CsvImportInvalidModeError } from "./csv-import-errors";
import { AllInOneCsvImporter } from "./importers/all-in-one-csv-importer";
import { CompaniesCsvImporter } from "./importers/companies-csv-importer";
import { ContactsCsvImporter } from "./importers/contacts-csv-importer";
import { SitesCsvImporter } from "./importers/sites-csv-importer";

/**
 * Selects the right strategy for a given import mode.
 *
 * All four modes ship with a real strategy. The switch below is the
 * single source of truth for mode → implementation mapping — call sites
 * never branch on mode.
 *
 * Centralizes mode validation : an invalid mode string surfaces as a
 * typed `CsvImportInvalidModeError` here, so callers don't repeat the
 * `mode in CSV_IMPORT_MODES` check.
 *
 * Naming follows the canonical "factory of strategy" pattern documented
 * in CLAUDE.md (mirrors `lib/ai/llm-strategy-provider-factory.ts`).
 */
export class CsvImporterFactory {
  /**
   * Returns a freshly-constructed strategy. Strategies hold no per-request
   * state, so we don't bother caching — each action call constructs its
   * own instance via the relevant subclass constructor.
   */
  public static getInstance(mode: CsvImportMode): CsvImporter {
    if (!isValidMode(mode)) {
      throw new CsvImportInvalidModeError(String(mode));
    }
    switch (mode) {
      case "companies":
        return new CompaniesCsvImporter();
      case "contacts":
        return new ContactsCsvImporter();
      case "sites":
        return new SitesCsvImporter();
      case "all-in-one":
        return new AllInOneCsvImporter();
    }
  }
}

function isValidMode(mode: string): mode is CsvImportMode {
  return (CSV_IMPORT_MODES as readonly string[]).includes(mode);
}

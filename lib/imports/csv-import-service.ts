import "server-only";

import {
  type CsvImportContext,
  type CsvImportMode,
  type CsvImportResult,
  type CsvRowOutcome,
} from "./csv-importer";
import { CsvImporterFactory } from "./csv-importer-factory";
import { parseCsvStream } from "./csv-parser";

/**
 * Facade orchestrating one full CSV import.
 *
 * Composes :
 *   - the streaming `parseCsvStream` (one row at a time, constant memory)
 *   - the right strategy from `CsvImporterFactory` (mode → importer)
 *
 * The action layer (`lib/actions/imports.ts`, landing in slice 2) calls
 * `import()` and gets back a fully-aggregated `CsvImportResult`. The
 * Facade enforces the per-row transaction contract by `await`ing each
 * strategy call sequentially — partial imports are by design, a bad row
 * never aborts the whole file.
 *
 * Outcomes are truncated past `maxOutcomes` so a 5k-row report doesn't
 * balloon the action's serialized payload.
 */

const DEFAULT_MAX_OUTCOMES = 1_000;

export class CsvImportService {
  constructor(private readonly factory: typeof CsvImporterFactory = CsvImporterFactory) {}

  /**
   * Runs the full CSV through the strategy.
   *
   * `dryRun = true` runs `validateRow` only — no DB writes. Used by the
   * preview step ; the returned counts reflect "what would happen if we
   * committed now". Per-row outcomes carry the same `created/updated/error`
   * shape so the UI can render the same preview table for both phases.
   *
   * `dryRun = false` runs `importRow` — full pipeline with per-row Drizzle
   * transactions.
   */
  public async run(params: {
    mode: CsvImportMode;
    csv: string;
    context: CsvImportContext;
    dryRun: boolean;
    maxOutcomes?: number;
  }): Promise<CsvImportResult> {
    const importer = this.factory.getInstance(params.mode);
    const maxOutcomes = params.maxOutcomes ?? DEFAULT_MAX_OUTCOMES;

    let totalRows = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const outcomes: CsvRowOutcome[] = [];

    for await (const { line, data } of parseCsvStream(params.csv)) {
      totalRows++;
      const outcome = params.dryRun
        ? await importer.validateRow(data, line, params.context)
        : await importer.importRow(data, line, params.context);

      switch (outcome.status) {
        case "created": created++; break;
        case "updated": updated++; break;
        case "skipped": skipped++; break;
        case "error":   errors++;  break;
      }

      if (outcomes.length < maxOutcomes) outcomes.push(outcome);
    }

    return {
      mode: params.mode,
      totalRows,
      created,
      updated,
      skipped,
      errors,
      outcomes,
    };
  }
}

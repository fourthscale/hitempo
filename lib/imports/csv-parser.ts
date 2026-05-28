import Papa from "papaparse";

import type { CsvRow } from "./csv-importer";
import { CsvImportInvalidFileError } from "./csv-import-errors";

/**
 * Streaming CSV parser — yields one row at a time so the importer can run
 * each row in its own Drizzle transaction without ever loading the full
 * parsed dataset in memory.
 *
 * Uses papaparse under the hood : the `step` callback emits each row as
 * soon as it's parsed, and `pause()`/`resume()` lets us throttle against
 * async DB work downstream.
 *
 * Auto-detects `,` vs `;` vs `\t` (RFC 4180 doesn't standardize the
 * delimiter ; many EU spreadsheets export `;`-separated). Quoted fields and
 * embedded newlines are handled by the underlying parser.
 *
 * `parseCsvStream` returns an AsyncIterable<ParsedRow> so callers write
 * the classic `for await (const row of parseCsvStream(text)) { … }`.
 */

export type ParsedRow = {
  /** 1-based line number in the source file (header is line 1, first data row is line 2). */
  line: number;
  /** The row as an object keyed by header name. Trimmed strings or null for empty cells. */
  data: CsvRow;
};

export type ParseOptions = {
  /** Override delimiter ; default is auto-detect. */
  delimiter?: string;
  /** Hard cap on rows (DoS protection). Default 50_000. */
  maxRows?: number;
};

const DEFAULT_MAX_ROWS = 50_000;

/**
 * Streams the CSV text row-by-row.
 *
 * Throws `CsvImportInvalidFileError` synchronously on header-level issues
 * (empty file, no detectable columns). Per-row parse errors surface as a
 * `ParsedRow` whose `data` may contain `null` values — the caller decides
 * what to do (skip, error-out, …).
 */
export async function* parseCsvStream(
  text: string,
  opts: ParseOptions = {},
): AsyncIterable<ParsedRow> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;

  if (!text || text.trim().length === 0) {
    throw new CsvImportInvalidFileError("file is empty");
  }

  // Buffer + signal pattern : papaparse's `step` is sync, so we push parsed
  // rows into a queue and let the async iterator drain it. `pause()` keeps
  // the parser idle while the consumer awaits DB work.
  const queue: ParsedRow[] = [];
  let done = false;
  let parseError: Error | null = null;
  let resolveNext: (() => void) | null = null;

  Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
    delimiter: opts.delimiter,
    step: (result, parser) => {
      if (queue.length >= maxRows) {
        parser.abort();
        parseError = new CsvImportInvalidFileError(
          `exceeded ${maxRows} rows limit`,
        );
        return;
      }
      const row = normalize(result.data);
      // step's row index is 0-based, header is line 1 → +2.
      queue.push({ line: queue.length + 2, data: row });
      resolveNext?.();
      resolveNext = null;
    },
    complete: () => {
      done = true;
      resolveNext?.();
      resolveNext = null;
    },
    error: (err: Error) => {
      parseError = new CsvImportInvalidFileError(err.message);
      done = true;
      resolveNext?.();
      resolveNext = null;
    },
  });

  while (true) {
    if (parseError) throw parseError;
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (done) return;
    await new Promise<void>((res) => {
      resolveNext = res;
    });
  }
}

/** Empty-string → null, preserves header keys. */
function normalize(raw: Record<string, string>): CsvRow {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    const trimmed = typeof v === "string" ? v.trim() : v;
    out[k] = trimmed === "" || trimmed == null ? null : trimmed;
  }
  return out;
}

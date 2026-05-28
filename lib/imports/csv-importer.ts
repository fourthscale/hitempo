import "server-only";

/**
 * Contract every CSV importer strategy honors.
 *
 * One strategy per CSV mode (companies / contacts / sites / all-in-one).
 * `CsvImportService` (Facade) picks the right strategy via
 * `CsvImporterFactory` based on user-selected mode at upload time.
 *
 * Each strategy is responsible for :
 *   1. Validating a single parsed row against its Zod schema.
 *   2. Mapping CSV columns to DB columns (handling empty-strings → null,
 *      ref → UUID lookup, etc.).
 *   3. Upserting the resulting row(s) inside a per-row Drizzle transaction.
 *
 * Strategies are pure of HTTP concerns — they receive already-parsed rows
 * via a streaming iterator and return aggregated results. Streaming + per-row
 * tx pairing is enforced by the service layer, not the strategy itself.
 */

/** The set of import modes the system supports. */
export const CSV_IMPORT_MODES = [
  "companies",
  "contacts",
  "sites",
  "all-in-one",
] as const;
export type CsvImportMode = (typeof CSV_IMPORT_MODES)[number];

/** Tenant + user context flowing through every import. */
export type CsvImportContext = {
  organizationId: string;
  userId: string;
};

/** One parsed CSV row, keyed by header. Values are strings or null. */
export type CsvRow = Readonly<Record<string, string | null>>;

/**
 * Per-row outcome reported back to the user.
 *
 * `label` is an optional human-readable summary of the affected row (e.g.
 * "Example Hotel · ACME-001"). Each strategy populates it for the Detail
 * column in the preview / result table. Free-form — UI renders it verbatim.
 */
export type CsvRowOutcome =
  | { line: number; status: "created"; entityId: string; label?: string }
  | { line: number; status: "updated"; entityId: string; label?: string }
  | { line: number; status: "skipped"; reason: string; label?: string }
  | { line: number; status: "error"; message: string; field?: string };

/** Aggregated result of a full import. */
export type CsvImportResult = {
  mode: CsvImportMode;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Per-row outcomes (truncated to first N if oversized). */
  outcomes: CsvRowOutcome[];
};

/**
 * Contract each per-mode strategy implements. The Facade owns parsing +
 * row dispatch ; the strategy owns row → DB.
 *
 * Each strategy must expose two paths :
 *   - `validateRow` — pure validation, no DB write. Used by the preview
 *     step before the user confirms.
 *   - `importRow`   — full pipeline (validate + FK resolve + upsert)
 *     inside a per-row Drizzle transaction. Used at commit time.
 *
 * Both return `CsvRowOutcome` ; on row-level issues they surface
 * `status: "error"` instead of throwing.
 */
export interface CsvImporter {
  /** Stable identifier surfaced in audit logs / telemetry. */
  readonly mode: CsvImportMode;

  /**
   * Pure validation : check that the row fits the Zod schema and any
   * required cross-references could resolve. Never writes to the DB.
   *
   * For preview UI : tells the user "is this row clean enough to commit?"
   * without making any change.
   */
  validateRow(row: CsvRow, line: number, ctx: CsvImportContext): Promise<CsvRowOutcome>;

  /**
   * Validate + persist. Wraps the actual mutation in a per-row Drizzle
   * transaction. Never throws on row-level issues — surfaces them as
   * `status: "error"`. Throws only on infra failures (DB down, etc.),
   * which the Facade catches.
   */
  importRow(row: CsvRow, line: number, ctx: CsvImportContext): Promise<CsvRowOutcome>;
}

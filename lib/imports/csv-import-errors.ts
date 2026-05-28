import { UserFacingActionError } from "@/lib/actions/user-facing-action-error";

/**
 * Typed errors for the CSV import pipeline.
 *
 * Two flavors :
 *   - **service-level** failures (bad mode, malformed CSV, file too big) →
 *     extend `UserFacingActionError` so the global modal surfaces them.
 *   - **row-level** issues are NOT errors — they're collected as
 *     `CsvRowOutcome { status: "error" }` so a bad row doesn't kill the
 *     whole import.
 *
 * The infra-level `NotImplementedError` is used by stub strategies during
 * slice 1 (before each real strategy ships in slices 2-5).
 */

/** The submitted mode value isn't one of the four supported modes. */
export class CsvImportInvalidModeError extends UserFacingActionError {
  public readonly code = "CSV_IMPORT_INVALID_MODE";
  constructor(public readonly received: string) {
    super(`Unsupported CSV import mode: ${received}`);
  }
}

/** The uploaded file isn't a recognized CSV / TSV. */
export class CsvImportInvalidFileError extends UserFacingActionError {
  public readonly code = "CSV_IMPORT_INVALID_FILE";
  constructor(message: string) {
    super(`Invalid CSV file: ${message}`);
  }
}

/** The file exceeds the configured size limit. */
export class CsvImportFileTooLargeError extends UserFacingActionError {
  public readonly code = "CSV_IMPORT_FILE_TOO_LARGE";
  constructor(public readonly sizeBytes: number, public readonly maxBytes: number) {
    super(`CSV file too large: ${sizeBytes} bytes (max ${maxBytes})`);
  }
}


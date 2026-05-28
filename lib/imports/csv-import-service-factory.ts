import "server-only";

import { CsvImportService } from "./csv-import-service";

/**
 * Lazy singleton factory for the CSV import service.
 *
 * The service is stateless — the singleton is just to mirror the
 * `getInstance()` convention used throughout the codebase
 * (`LlmGenerationServiceFactory`, `ScoringEngineFactory`, etc.).
 *
 * `setInstance` / `reset` exist for tests : inject a service built with a
 * mocked importer factory.
 */
export class CsvImportServiceFactory {
  private static cached: CsvImportService | null = null;

  public static getInstance(): CsvImportService {
    if (this.cached) return this.cached;
    this.cached = new CsvImportService();
    return this.cached;
  }

  public static setInstance(service: CsvImportService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}

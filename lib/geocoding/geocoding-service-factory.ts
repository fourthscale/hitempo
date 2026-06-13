import "server-only";

import { BanGeocoder } from "./ban-geocoder";
import { GeocodingService } from "./geocoding-service";
import { NominatimGeocoder } from "./nominatim-geocoder";

/**
 * Singleton wiring for the GeocodingService. Mirrors the
 * `LlmStrategyProviderFactory` / `GmailServiceFactory` shape used
 * elsewhere in the project : one entry point per service, a private
 * cached instance, no parameters from the caller.
 *
 * Note the Nominatim rate limit is per-instance (the geocoder tracks
 * its own `lastRequestAt`) ; reusing the singleton across the process
 * means cron jobs + backfill actions + edit-time writes all share the
 * same 1-r/s gate, which is exactly what Nominatim's ToS requires.
 */
export class GeocodingServiceFactory {
  private static instance: GeocodingService | null = null;

  public static getInstance(): GeocodingService {
    if (!this.instance) {
      this.instance = new GeocodingService(
        new BanGeocoder(),
        new NominatimGeocoder(),
      );
    }
    return this.instance;
  }

  /** Test-only : drop the cached instance so the next call rebuilds
   *  with whatever environment the test set up. */
  public static reset(): void {
    this.instance = null;
  }
}

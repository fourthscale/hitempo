/**
 * Strategy contract for the geocoding subsystem.
 *
 * Each concrete strategy talks to one geocoding provider (BAN for FR,
 * Nominatim for the rest of the world). The Facade routes by country
 * — see `GeocodingService`.
 *
 * Strategies are pure : same input → same output (modulo provider
 * weather). They never persist to the DB ; the caller is responsible
 * for writing the result back. This keeps testing easy (mock the
 * fetch, no DB roundtrip) and respects the Single Responsibility
 * principle.
 */

export type GeocodingInput = {
  /** Free-form first line of the address (street + number). */
  addressLine1: string | null;
  /** Postal code / ZIP. */
  postalCode: string | null;
  city: string | null;
  region: string | null;
  /** ISO 3166-1 alpha-2 country code, e.g. "FR", "DE". Always
   *  uppercased by the caller. */
  country: string;
};

export type GeocodingResult = {
  lat: number;
  lng: number;
  /** Optional provider-specific identifier (BAN "id", Nominatim
   *  "osm_id") — kept around for debugging only, never persisted. */
  providerId: string | null;
  /** Provider's confidence score [0,1] when available. NULL means
   *  the provider didn't expose one. */
  confidence: number | null;
};

export interface GeocodingStrategy {
  /** Identifier used in logs and the Service routing — e.g. "ban". */
  readonly providerName: string;

  /**
   * Look up a single address. Throws a typed `GeocodingError` on any
   * failure — caller decides what's recoverable (`GeocodingNotFound`
   * is non-recoverable for a missing address, `GeocodingHttp` is
   * worth retrying).
   */
  geocode(input: GeocodingInput): Promise<GeocodingResult>;
}

/** Helper : compose a single human-readable query string from the
 *  structured input. Used by both strategies as the search input. */
export function composeAddressQuery(input: GeocodingInput): string {
  const parts = [
    input.addressLine1,
    input.postalCode,
    input.city,
    input.region,
    input.country,
  ].filter((part) => typeof part === "string" && part.trim().length > 0);
  return parts.join(", ").trim();
}

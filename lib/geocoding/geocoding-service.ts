import "server-only";

import {
  type GeocodingInput,
  type GeocodingResult,
  type GeocodingStrategy,
} from "./geocoding-strategy";

/**
 * Facade that routes a geocoding request to the right strategy by
 * country. FR → BAN (fast, unlimited, high precision). Anything else →
 * Nominatim (rate-limited, worldwide coverage). The two strategies
 * are injected at construction time so tests can substitute either
 * without touching the network.
 *
 * Strategies stay pluggable : we can swap a different per-country
 * strategy without changing the call sites (e.g. add a UK / Royal Mail
 * provider later).
 */
export class GeocodingService {
  constructor(
    private readonly frStrategy: GeocodingStrategy,
    private readonly worldStrategy: GeocodingStrategy,
  ) {}

  public async geocode(input: GeocodingInput): Promise<GeocodingResult> {
    const country = (input.country ?? "").trim().toUpperCase();
    const strategy = country === "FR" ? this.frStrategy : this.worldStrategy;
    return strategy.geocode({ ...input, country: country || "FR" });
  }
}
